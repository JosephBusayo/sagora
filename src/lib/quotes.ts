import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { formatAmount } from "./money";
import { getById as getRequest, ownedBy } from "./requests";
import { ensureJobForAgreement } from "./jobs";
import { serviceFeeOn } from "./fee";
import {
  convert as convertHolds, forQuote as holdsForQuote, place,
  release as releaseHolds, releaseOthers, type Requested,
} from "./holds";

/**
 * Quotes are versioned, and accepting one freezes the exact version that was accepted into an
 * agreement. Both are brief rules: "quote matches accepted version". A provider changing a
 * quote never rewrites what the farmer already saw; it supersedes it with a new version.
 *
 * Accepting is NOT a booking. It records agreed terms. Payment, holds and the single booking
 * decision come in stage 4.
 */

export type QuoteStatus = "sent" | "superseded" | "withdrawn" | "accepted" | "not_selected";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  sent: "Waiting for the farmer",
  superseded: "Replaced by a newer version",
  withdrawn: "Withdrawn",
  accepted: "Accepted",
  not_selected: "Farmer chose another provider",
};

export type Quote = {
  id: string; requestId: string; businessId: string; version: number;
  amountMinor: number; includes: string; startDate: string; validUntil: string;
  note: string; status: QuoteStatus; declinedAt: string | null; createdAt: string;
  /** How many days the provider says the work takes, counting the start day. Never below 1. */
  daysToComplete: number;
  /** The rate per working day. Zero on a quote sent before the handover asked for it. */
  dailyRateMinor: number;
  /** The machines held against this price from the moment it was sent. */
  assetIds: string[];
  /** The named operator held with them. */
  operatorId: string | null;
  /** The exact moment this stops being acceptable. Empty on rows written before migration 025. */
  expiresAt: string;
};

type Row = {
  id: string; request_id: string; business_id: string; version: number; amount_minor: number;
  includes: string; start_date: string; valid_until: string; note: string; status: QuoteStatus; declined_at: string | null; created_at: string;
  days_to_complete?: number | null;
  daily_rate_minor?: number | null;
  operator_id?: string | null;
  expires_at?: string | null;
};

async function fromRow(r: Row, t: Queries = db): Promise<Quote> {
  const ids = await t.all("SELECT equipment_id FROM quote_asset WHERE quote_id=?", r.id) as { equipment_id: string }[];
  return {
    id: r.id, requestId: r.request_id, businessId: r.business_id, version: r.version,
    amountMinor: r.amount_minor, includes: r.includes, startDate: r.start_date,
    validUntil: r.valid_until, note: r.note, status: r.status, declinedAt: r.declined_at, createdAt: r.created_at,
    daysToComplete: Math.max(1, Number(r.days_to_complete ?? 1)),
    dailyRateMinor: Number(r.daily_rate_minor ?? 0),
    operatorId: r.operator_id ?? null,
    expiresAt: r.expires_at ?? "",
    assetIds: ids.map((i) => i.equipment_id),
  };
}

/**
 * How long a farmer has to answer a quote. Karim set 48 hours on 22 November and the handover of
 * 23 November keeps it: "the discussed starting hold is 48 hours, with the exact expiry shown".
 */
export const RESPONSE_HOURS = 48;

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

/**
 * The exact moment a quote stops being acceptable: 48 hours, or the start of the day the work was
 * meant to begin, whichever comes first.
 *
 * The cap is the handover's — "never let it run past the proposed start" — and it matters because
 * a flat 48 hours can outlive the work. A quote sent this evening for tomorrow's ploughing would
 * otherwise still be live tomorrow night, holding a tractor for a day that has already gone.
 *
 * Sierra Leone keeps UTC+0 all year, so midnight UTC is midnight in Freetown and no conversion is
 * needed anywhere in this calculation.
 */
export function expiryFor(sentAtIso: string, startDate: string): string {
  const window = Date.parse(sentAtIso) + RESPONSE_HOURS * 3600_000;
  const start = Date.parse(startDate + "T00:00:00Z");
  return new Date(Math.min(window, start)).toISOString();
}

/** The last moment this quote can be accepted. Older rows have no stored instant; they get 48 hours. */
export const expiresAt = (q: Pick<Quote, "createdAt" | "expiresAt">) =>
  new Date(q.expiresAt ? Date.parse(q.expiresAt) : Date.parse(q.createdAt) + RESPONSE_HOURS * 3600_000);

/**
 * A quote nobody answered inside the window can be read back but never accepted, and everything it
 * held is free again. Worked out from the clock rather than from a swept status column, so it is
 * true the moment it becomes true and never waits on the nightly sweep to catch up.
 */
export const isExpired = (q: Quote) => q.status === "sent" && Date.now() > expiresAt(q).getTime();

/** The last day the work would run, from the start date and the days the provider quoted. */
export const endDateOf = (q: Pick<Quote, "startDate" | "daysToComplete">) => addDays(q.startDate, Math.max(1, q.daysToComplete) - 1);

export type QuoteInput = {
  amountMinor: number; includes: string; startDate: string; note: string;
  daysToComplete: number;
  /** The provider's rate per working day. The service total is still amount_minor. */
  dailyRateMinor: number;
  /** Actual machines, never a type. The handover requires at least one. */
  assetIds: string[];
  /** The actual person who will run it, from this business's team. */
  operatorId: string;
};

/** This business's current quote on a request, whatever its state. */
export async function currentQuote(requestId: string, businessId: string): Promise<Quote | null> {
  const r = await db.get("SELECT * FROM quote WHERE request_id=? AND business_id=? ORDER BY version DESC LIMIT 1", requestId, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function listForRequest(requestId: string): Promise<Quote[]> {
  const rows = await db.all("SELECT * FROM quote WHERE request_id=? AND status IN ('sent','accepted','not_selected') ORDER BY amount_minor ASC", requestId) as Row[];
  return Promise.all(rows.map((r) => fromRow(r)));
}

export async function listForBusiness(businessId: string): Promise<(Quote & { reference: string; service: string; district: string })[]> {
  const rows = await db.all(`SELECT q.*, r.reference, r.service, r.district FROM quote q JOIN service_request r ON r.id = q.request_id
       WHERE q.business_id=? AND q.status <> 'superseded' ORDER BY q.created_at DESC`, businessId) as (Row & { reference: string; service: string; district: string })[];
  return Promise.all(rows.map(async (r) => ({ ...(await fromRow(r)), reference: r.reference, service: r.service, district: r.district })));
}

export async function getQuote(id: string): Promise<Quote | null> {
  const r = await db.get("SELECT * FROM quote WHERE id=?", id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export type SendResult = { ok: true; quote: Quote } | { ok: false; reason: string };

/**
 * Sends a quote, or replaces this business's previous one with a new version.
 * The old version is kept and marked superseded, so what the farmer saw is never rewritten.
 */
export async function sendQuote(requestId: string, businessId: string, actorId: string, input: QuoteInput): Promise<SendResult> {
  const request = await getRequest(requestId);
  if (!request) return { ok: false, reason: "That request no longer exists." };
  if (request.status === "cancelled") return { ok: false, reason: "That request was withdrawn by the farmer." };
  if (request.status === "completed") return { ok: false, reason: "That request is already finished." };

  const existing = await currentQuote(requestId, businessId);
  if (existing?.status === "accepted") return { ok: false, reason: "Your quote has already been accepted." };
  if (existing?.status === "not_selected") {
    return { ok: false, reason: existing.declinedAt ? "The farmer declined your quote." : "The farmer has chosen another provider." };
  }

  // The handover's opening rule: no quotation without capacity, and capacity means actual things.
  if (input.assetIds.length === 0) {
    return { ok: false, reason: "Choose the actual equipment this price is for. A quote cannot be sent without it." };
  }
  if (!input.operatorId) {
    return { ok: false, reason: "Choose the operator who will do the work. A quote cannot be sent without one." };
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const version = (existing?.version ?? 0) + 1;
  const expires = expiryFor(now, input.startDate);
  // Already past, because the work starts today or sooner. Holding nothing for no time is not a
  // quote, so it is refused here rather than sent and expired in the same breath.
  if (Date.parse(expires) <= Date.parse(now)) {
    return { ok: false, reason: "The start date is too soon to quote: a price has to hold until the work begins." };
  }
  // valid_until predates the 48-hour rule. It is kept as the day the window closes so the column
  // still means what its name says, but expires_at is the instant everything now reads.
  const validUntil = expires.slice(0, 10);
  const endDate = endDateOf({ startDate: input.startDate, daysToComplete: input.daysToComplete });

  const requested: Requested[] = [
    ...input.assetIds.map((resourceId) => ({ kind: "equipment" as const, resourceId, label: "Equipment" })),
    { kind: "operator" as const, resourceId: input.operatorId, label: "Operator" },
  ];

  // One transaction for the clash check, the quote and every hold. "If any resource conflicts,
  // send nothing and leave no partial holds."
  const placed = await db.tx<{ ok: true } | { ok: false; reason: string }>(async (t) => {
    // Anything this business sent before is replaced, never edited; its holds move with it.
    await t.run("UPDATE quote SET status='superseded' WHERE request_id=? AND business_id=? AND status='sent'", requestId, businessId);
    if (existing) await releaseHolds(existing.id, "Quote replaced by a newer version", t);

    await t.run(`INSERT INTO quote (id, request_id, business_id, version, amount_minor, includes, start_date, valid_until, note,
         days_to_complete, daily_rate_minor, operator_id, expires_at, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, requestId, businessId, version, input.amountMinor, input.includes, input.startDate, validUntil, input.note,
      input.daysToComplete, input.dailyRateMinor, input.operatorId, expires, actorId, now);
    for (const assetId of input.assetIds) await t.run("INSERT INTO quote_asset (quote_id, equipment_id) VALUES (?,?)", id, assetId);

    const held = await place(id, requestId, businessId, requested, input.startDate, endDate, expires, t);
    if (!held.ok) {
      // Naming what is in the way, because "each case blocks Send quotation with a specific
      // reason". Throwing rolls the quote back with the holds, leaving no trace of either.
      const names = new Map<string, string>();
      for (const c of held.clashes) {
        const row = c.kind === "equipment"
          ? await t.get("SELECT name FROM equipment WHERE id=?", c.resourceId) as { name: string } | undefined
          : await t.get("SELECT name FROM team_member WHERE id=?", c.resourceId) as { name: string } | undefined;
        names.set(c.resourceId, row?.name ?? (c.kind === "equipment" ? "That equipment" : "That operator"));
      }
      throw new HoldConflict(held.clashes.map((c) => `${names.get(c.resourceId)} is ${c.why}`).join("; "));
    }

    // Once anyone has quoted, the farmer's request says so.
    await t.run("UPDATE service_request SET status='quotes_sent', updated_at=? WHERE id=? AND status='awaiting_quotes'", now, requestId);
    return { ok: true };
  }).catch((err: unknown) => {
    if (err instanceof HoldConflict) return { ok: false as const, reason: err.message };
    throw err;
  });
  if (!placed.ok) return { ok: false, reason: placed.reason };

  await audit(actorId, version === 1 ? "quote.sent" : "quote.revised", id, `v${version} ${input.amountMinor}`);
  await audit(actorId, "hold.placed", id, `${requested.length} resources to ${expires}`);
  return { ok: true, quote: (await getQuote(id))! };
}

/**
 * Carries a clash out of the transaction that found it.
 *
 * The clash check and the writes have to be one transaction, and the only way to abandon a
 * transaction is to throw. This turns that throw back into the ordinary refusal the caller
 * expects, so a busy tractor reads as a message rather than a crash.
 */
class HoldConflict extends Error {}

/**
 * Whether a quote's own holds are still standing.
 *
 * Since the handover, sending a quote reserves everything it names, so a live quote cannot be
 * clashing with anyone: whatever it holds, it holds. What can happen is that its holds lapsed,
 * or were released, and then there is nothing behind the price. That is what this reports, and
 * it is why acceptance checks it.
 */
export async function holdsIntact(q: Quote, t: Queries = db): Promise<boolean> {
  const holds = await holdsForQuote(q.id, t);
  const live = holds.filter((h) => h.status === "held" && Date.now() <= Date.parse(h.expiresAt || q.createdAt));
  // One per machine, plus the operator. Anything fewer means something let go.
  const wanted = q.assetIds.length + (q.operatorId ? 1 : 0);
  return wanted === 0 ? true : live.length >= wanted;
}

export async function withdrawQuote(requestId: string, businessId: string, actorId: string): Promise<boolean> {
  const quote = await currentQuote(requestId, businessId);
  const res = await db.run("UPDATE quote SET status='withdrawn' WHERE request_id=? AND business_id=? AND status='sent'", requestId, businessId);
  if (res.changes) {
    // Withdrawing frees the machines at once: "release unused capacity".
    if (quote) await releaseHolds(quote.id, "Provider withdrew the quote");
    await audit(actorId, "quote.withdrawn", requestId);
  }
  return res.changes > 0;
}

export type AcceptResult = { ok: true } | { ok: false; reason: string };

/**
 * The farmer accepts one quote. In a single transaction this freezes the accepted version into
 * an agreement, marks the other providers' quotes as not selected, and moves the request on.
 * Re-running it is harmless: the unique request_id on agreement means a second accept fails.
 */
export async function acceptQuote(quoteId: string, farmerId: string, onBehalf = false): Promise<AcceptResult> {
  const quote = await getQuote(quoteId);
  if (!quote) return { ok: false, reason: "That quote no longer exists." };

  const request = await getRequest(quote.requestId);
  // A coordinator can accept only on a request they took for a farmer with no account.
  const allowed = onBehalf ? Boolean(request?.assistedBy) : Boolean(request && ownedBy(request, farmerId));
  if (!request || !allowed) return { ok: false, reason: "That quote is not on your request." };
  if (request.status === "cancelled") return { ok: false, reason: "You withdrew this request." };
  if (quote.status !== "sent") return { ok: false, reason: "That quote is no longer open." };
  if (isExpired(quote)) {
    return { ok: false, reason: `That quote expired after ${RESPONSE_HOURS} hours without an answer. Ask the provider for a new one.` };
  }

  const now = new Date().toISOString();
  const endDate = endDateOf(quote);
  // Accepting is one decision: the frozen agreement, the losing quotes and the request's own
  // state all move together, or none of them do.
  const decided = await db.tx<AcceptResult>(async (t) => {
    const already = await t.get("SELECT 1 FROM agreement WHERE request_id=?", quote.requestId);
    // Nothing has been written yet, so returning here commits an empty transaction.
    if (already) return { ok: false, reason: "You have already accepted a quote on this request." };

    // Since the handover, the machines were reserved when the quote was sent, so accepting does
    // not have to win a race for them — but it does have to check they are still there. A hold
    // that lapsed, or was released, leaves a price with nothing behind it.
    if (!(await holdsIntact(quote, t))) {
      return {
        ok: false,
        reason: "The equipment this quote reserved is no longer held for those dates. " +
          "Ask the provider for a new quote.",
      };
    }

    // Sagora's 10% is added to the provider's price, never taken out of it (handover, 23 Nov 2026):
    // provider 2,000 + fee 200 = farmer 2,200. Frozen here with the rest of the agreement so a
    // later change to the fee policy cannot alter what this farmer owes.
    const feeMinor = serviceFeeOn(quote.amountMinor);

    // The agreement is a frozen copy: later edits to the quote cannot change what was agreed.
    await t.run(`INSERT INTO agreement (id, request_id, quote_id, business_id, version, amount_minor, fee_minor, includes, start_date, accepted_by, accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, randomUUID(), quote.requestId, quote.id, quote.businessId, quote.version, quote.amountMinor, feeMinor, quote.includes, quote.startDate, farmerId, now);
    await t.run("UPDATE quote SET status='accepted' WHERE id=?", quote.id);
    await t.run("UPDATE quote SET status='not_selected' WHERE request_id=? AND id<>? AND status='sent'", quote.requestId, quote.id);
    await t.run("UPDATE service_request SET status='in_progress', updated_at=? WHERE id=?", now, quote.requestId);

    // "Selecting one quote closes competing quotes for the same request and releases their holds."
    // The losing providers get their machines back the moment the farmer chooses.
    await releaseOthers(quote.requestId, quote.id, "The farmer chose another provider", t);
    // This quote's own holds become the booking's commitment rather than a second reservation.
    await convertHolds(quote.id, t);

    // The work, with the dates and machines the farmer accepted already on it. A quote that named
    // no equipment still makes an unscheduled job, exactly as every quote did before this change.
    const job = await t.get("SELECT id FROM job WHERE request_id=?", quote.requestId) as { id: string } | undefined;
    const jobId = job?.id ?? randomUUID();
    if (!job) {
      await t.run("INSERT INTO job (id, request_id, business_id, created_at, updated_at) VALUES (?,?,?,?,?)",
        jobId, quote.requestId, quote.businessId, now, now);
    }
    // Everything the quote held becomes the job's own commitment: the dates, the machines and the
    // named operator. Nothing is chosen again here, which is the point — "do not create a second
    // reservation".
    if (quote.assetIds.length > 0) {
      await t.run(`UPDATE job SET start_date=?, end_date=?, operator_id=?,
           status=CASE WHEN status='unscheduled' THEN 'scheduled' ELSE status END, updated_at=?
         WHERE id=?`, quote.startDate, endDate, quote.operatorId, now, jobId);
      for (const assetId of quote.assetIds) {
        await t.run("INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?) ON CONFLICT DO NOTHING", jobId, assetId);
      }
    }
    return { ok: true };
  });
  if (!decided.ok) return decided;

  await audit(farmerId, "quote.accepted", quote.id, `v${quote.version} ${quote.amountMinor}`);
  // Covers the one case the transaction above leaves alone: a quote with no equipment named, which
  // still needs the job row to exist before anyone can schedule it.
  await ensureJobForAgreement(quote.requestId, quote.businessId);
  return { ok: true };
}

/** The farmer turns one quote down. The request stays open for the others. */
export async function declineQuote(quoteId: string, farmerId: string): Promise<boolean> {
  const quote = await getQuote(quoteId);
  if (!quote) return false;
  const request = await getRequest(quote.requestId);
  if (!request || !ownedBy(request, farmerId)) return false;
  const res = await db.run("UPDATE quote SET status='not_selected', declined_at=? WHERE id=? AND status='sent'", new Date().toISOString(), quoteId);
  if (res.changes) await audit(farmerId, "quote.declined", quoteId);
  return res.changes > 0;
}

export type Agreement = {
  businessId: string; amountMinor: number; version: number; includes: string; startDate: string;
  /** Sagora's fee, frozen when the farmer accepted. */
  feeMinor: number;
  /** What the farmer owes: the provider's price plus that fee. */
  farmerTotalMinor: number;
};

export async function agreementFor(requestId: string): Promise<Agreement | null> {
  const r = await db.get(`SELECT business_id, amount_minor, fee_minor, version, includes, start_date
       FROM agreement WHERE request_id=?`, requestId) as
    { business_id: string; amount_minor: number; fee_minor: number | null; version: number; includes: string; start_date: string } | undefined;
  if (!r) return null;
  const amountMinor = Number(r.amount_minor);
  // Agreements accepted before migration 025 carry no fee. They were charged the provider price
  // and had the fee taken out of the payout, so their farmer total is still that price.
  const feeMinor = Number(r.fee_minor ?? 0);
  return {
    businessId: r.business_id, amountMinor, feeMinor, farmerTotalMinor: amountMinor + feeMinor,
    version: r.version, includes: r.includes, startDate: r.start_date,
  };
}

export type ActivityItem = { at: string; text: string };

/**
 * What has happened on a request, as one provider may see it: the request itself and their own
 * quotes, never another provider's.
 */
export async function activityFor(requestId: string, businessId: string, submittedAt: string): Promise<ActivityItem[]> {
  const rows = await db.all("SELECT * FROM quote WHERE request_id=? AND business_id=? ORDER BY version ASC", requestId, businessId) as Row[];
  const items: ActivityItem[] = [{ at: submittedAt, text: "The farmer sent this request" }];
  for (const q of await Promise.all(rows.map((r) => fromRow(r)))) {
    items.push({ at: q.createdAt, text: q.version === 1 ? "You sent a quote" : `You sent version ${q.version} of your quote` });
    if (q.declinedAt) items.push({ at: q.declinedAt, text: "The farmer declined your quote" });
  }
  const accepted = await db.get("SELECT accepted_at FROM agreement WHERE request_id=? AND business_id=?", requestId, businessId) as { accepted_at: string } | undefined;
  if (accepted) items.push({ at: accepted.accepted_at, text: "The farmer accepted your quote" });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Tells both sides about quotes that ran out of time, and is how the machines get released in
 * practice: once a quote is past its window isExpired() refuses it everywhere, so nothing is
 * holding the equipment any more and the provider is free to put it behind another price.
 *
 * Status is deliberately not rewritten. Expiry is a fact about the clock, so computing it keeps
 * every screen right the instant it becomes true rather than at six the next morning; this sweep
 * only sends the notices. It looks back a few days rather than over all history, and the outbox's
 * dedupe key means a quote is announced exactly once however often the sweep runs.
 */
export async function sweepExpiredQuotes(): Promise<number> {
  // enqueue rather than notify: the caller is the cron route, which drains straight afterwards, so
  // notify's per-message drain would be redundant — and enqueue says whether the message was
  // actually stored or dropped as a duplicate, which is the number worth reporting.
  const { enqueue } = await import("./outbox");
  const now = Date.now();
  const lapsedBefore = new Date(now - RESPONSE_HOURS * 3600_000).toISOString();
  const lookBack = new Date(now - (RESPONSE_HOURS + 7 * 24) * 3600_000).toISOString();
  const rows = await db.all(`SELECT q.*, r.reference, r.service, r.contact_email, b.name AS business, b.email AS provider_email
       FROM quote q JOIN service_request r ON r.id = q.request_id JOIN provider_business b ON b.id = q.business_id
       WHERE q.status='sent' AND q.created_at < ? AND q.created_at > ? AND r.status NOT IN ('cancelled','completed')
       ORDER BY q.created_at ASC`, lapsedBefore, lookBack) as (Row & {
    reference: string; service: string; contact_email: string | null; business: string; provider_email: string | null;
  })[];

  let told = 0;
  for (const row of rows) {
    const q = await fromRow(row);
    if (row.contact_email) {
      const stored = await enqueue({
        kind: "quote.expired", dedupeKey: `quote-expired-farmer:${q.id}`, to: row.contact_email,
        subject: `A quote on ${row.reference} has expired`,
        text:
          `${row.business} quoted ${formatAmount(q.amountMinor)} for your ${row.service} request ${row.reference}, and that price has now ` +
          `run out: a quote holds for ${RESPONSE_HOURS} hours.\n\nThe equipment they had set aside is free again. Sign in and ask them ` +
          "for a new quote if you still want the work done.",
      });
      if (stored) told += 1;
    }
    if (row.provider_email) {
      const stored = await enqueue({
        kind: "quote.expired", dedupeKey: `quote-expired-provider:${q.id}`, to: row.provider_email,
        subject: `Your quote on ${row.reference} expired`,
        text:
          `The farmer did not answer your quote on ${row.reference} within ${RESPONSE_HOURS} hours, so it can no longer be accepted.\n\n` +
          "Any equipment you named on it is free for other work. You can send a fresh quote at any time.",
      });
      if (stored) told += 1;
    }
  }
  return told;
}
