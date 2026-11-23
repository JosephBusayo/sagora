import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { formatAmount } from "./money";
import { getById as getRequest, ownedBy } from "./requests";
import { clashesFor, ensureJobForAgreement } from "./jobs";

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
  /** The machines the provider has put behind this price. Committed only once it is accepted. */
  assetIds: string[];
};

type Row = {
  id: string; request_id: string; business_id: string; version: number; amount_minor: number;
  includes: string; start_date: string; valid_until: string; note: string; status: QuoteStatus; declined_at: string | null; created_at: string;
  days_to_complete?: number | null;
};

async function fromRow(r: Row, t: Queries = db): Promise<Quote> {
  const ids = await t.all("SELECT equipment_id FROM quote_asset WHERE quote_id=?", r.id) as { equipment_id: string }[];
  return {
    id: r.id, requestId: r.request_id, businessId: r.business_id, version: r.version,
    amountMinor: r.amount_minor, includes: r.includes, startDate: r.start_date,
    validUntil: r.valid_until, note: r.note, status: r.status, declinedAt: r.declined_at, createdAt: r.created_at,
    daysToComplete: Math.max(1, Number(r.days_to_complete ?? 1)),
    assetIds: ids.map((i) => i.equipment_id),
  };
}

/**
 * How long a farmer has to answer a quote (Karim, 22 Nov 2026). It replaced the provider's own
 * "price holds until" date: one rule everybody knows beats a date each provider picks differently.
 */
export const RESPONSE_HOURS = 48;

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

/** A stored date as the screens around it write one: 16 Nov 2026, not 2026-11-16. */
const onDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** The last moment this quote can be accepted. */
export const expiresAt = (q: Pick<Quote, "createdAt">) => new Date(Date.parse(q.createdAt) + RESPONSE_HOURS * 3600_000);

/**
 * A quote nobody answered inside the window can be read back but never accepted, and the machines
 * it named are free again. Worked out from the clock rather than from a swept status column, so
 * it is true the moment it becomes true and never waits on the nightly sweep to catch up.
 */
export const isExpired = (q: Quote) => q.status === "sent" && Date.now() > expiresAt(q).getTime();

/** The last day the work would run, from the start date and the days the provider quoted. */
export const endDateOf = (q: Pick<Quote, "startDate" | "daysToComplete">) => addDays(q.startDate, Math.max(1, q.daysToComplete) - 1);

export type QuoteInput = {
  amountMinor: number; includes: string; startDate: string; note: string;
  daysToComplete: number; assetIds: string[];
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

  const now = new Date().toISOString();
  const id = randomUUID();
  const version = (existing?.version ?? 0) + 1;
  // valid_until is no longer asked of the provider; the 48-hour window is the rule. It is still
  // written, as the day that window closes, so the column keeps meaning the thing its name says.
  const validUntil = new Date(Date.parse(now) + RESPONSE_HOURS * 3600_000).toISOString().slice(0, 10);

  await db.tx(async (t) => {
    // Anything this business sent before is replaced, never edited.
    await t.run("UPDATE quote SET status='superseded' WHERE request_id=? AND business_id=? AND status='sent'", requestId, businessId);
    await t.run(`INSERT INTO quote (id, request_id, business_id, version, amount_minor, includes, start_date, valid_until, note, days_to_complete, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, requestId, businessId, version, input.amountMinor, input.includes, input.startDate, validUntil, input.note, input.daysToComplete, actorId, now);
    // Named, not committed: the machines are held only once the farmer accepts (see acceptQuote).
    for (const assetId of input.assetIds) await t.run("INSERT INTO quote_asset (quote_id, equipment_id) VALUES (?,?)", id, assetId);
    // Once anyone has quoted, the farmer's request says so.
    await t.run("UPDATE service_request SET status='quotes_sent', updated_at=? WHERE id=? AND status='awaiting_quotes'", now, requestId);
  });
  await audit(actorId, version === 1 ? "quote.sent" : "quote.revised", id, `v${version} ${input.amountMinor}`);
  return { ok: true, quote: (await getQuote(id))! };
}

/**
 * Which of a quote's machines are already committed elsewhere for the days it would run.
 *
 * Called before accepting, and shown to the provider on their own quotes so they learn about a
 * clash from their screen rather than from a farmer who could not accept. Open quotes never
 * appear here: only accepted work holds a machine.
 */
export async function quoteClashes(q: Quote, t: Queries = db): Promise<{ name: string; reference: string; from: string; to: string }[]> {
  if (q.assetIds.length === 0) return [];
  const end = endDateOf(q);
  const out: { name: string; reference: string; from: string; to: string }[] = [];
  for (const assetId of q.assetIds) {
    const clash = (await clashesFor(assetId, q.startDate, end, null, t))[0];
    if (!clash) continue;
    const asset = await t.get("SELECT name FROM equipment WHERE id=?", assetId) as { name: string } | undefined;
    out.push({ name: asset?.name ?? "That equipment", reference: clash.reference, from: clash.start_date, to: clash.end_date });
  }
  return out;
}

export async function withdrawQuote(requestId: string, businessId: string, actorId: string): Promise<boolean> {
  const res = await db.run("UPDATE quote SET status='withdrawn' WHERE request_id=? AND business_id=? AND status='sent'", requestId, businessId);
  if (res.changes) await audit(actorId, "quote.withdrawn", requestId);
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

    // Accepting is what commits the machines (Karim, 22 Nov 2026). Two farmers may hold quotes
    // naming the same tractor; the first to accept gets it for those days, and the second is told
    // why they cannot. The check sits inside this transaction so two accepts racing for one
    // machine cannot both pass it and then both write.
    const taken = (await quoteClashes(quote, t))[0];
    if (taken) {
      return {
        ok: false,
        reason: `${taken.name} is already committed to other work from ${onDay(taken.from)} to ${onDay(taken.to)}. ` +
          "Ask the provider for a new quote with different dates or equipment.",
      };
    }

    // The agreement is a frozen copy: later edits to the quote cannot change what was agreed.
    await t.run(`INSERT INTO agreement (id, request_id, quote_id, business_id, version, amount_minor, includes, start_date, accepted_by, accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`, randomUUID(), quote.requestId, quote.id, quote.businessId, quote.version, quote.amountMinor, quote.includes, quote.startDate, farmerId, now);
    await t.run("UPDATE quote SET status='accepted' WHERE id=?", quote.id);
    await t.run("UPDATE quote SET status='not_selected' WHERE request_id=? AND id<>? AND status='sent'", quote.requestId, quote.id);
    await t.run("UPDATE service_request SET status='in_progress', updated_at=? WHERE id=?", now, quote.requestId);

    // The work, with the dates and machines the farmer accepted already on it. A quote that named
    // no equipment still makes an unscheduled job, exactly as every quote did before this change.
    const job = await t.get("SELECT id FROM job WHERE request_id=?", quote.requestId) as { id: string } | undefined;
    const jobId = job?.id ?? randomUUID();
    if (!job) {
      await t.run("INSERT INTO job (id, request_id, business_id, created_at, updated_at) VALUES (?,?,?,?,?)",
        jobId, quote.requestId, quote.businessId, now, now);
    }
    if (quote.assetIds.length > 0) {
      await t.run(`UPDATE job SET start_date=?, end_date=?, status=CASE WHEN status='unscheduled' THEN 'scheduled' ELSE status END, updated_at=?
         WHERE id=?`, quote.startDate, endDate, now, jobId);
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

export async function agreementFor(requestId: string): Promise<{ businessId: string; amountMinor: number; version: number; includes: string; startDate: string } | null> {
  const r = await db.get("SELECT business_id, amount_minor, version, includes, start_date FROM agreement WHERE request_id=?", requestId) as { business_id: string; amount_minor: number; version: number; includes: string; start_date: string } | undefined;
  return r ? { businessId: r.business_id, amountMinor: r.amount_minor, version: r.version, includes: r.includes, startDate: r.start_date } : null;
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
