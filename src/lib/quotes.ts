import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { getById as getRequest } from "./requests";
import { ensureJobForAgreement } from "./jobs";

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
  note: string; status: QuoteStatus; createdAt: string;
};

type Row = {
  id: string; request_id: string; business_id: string; version: number; amount_minor: number;
  includes: string; start_date: string; valid_until: string; note: string; status: QuoteStatus; created_at: string;
};
const fromRow = (r: Row): Quote => ({
  id: r.id, requestId: r.request_id, businessId: r.business_id, version: r.version,
  amountMinor: r.amount_minor, includes: r.includes, startDate: r.start_date,
  validUntil: r.valid_until, note: r.note, status: r.status, createdAt: r.created_at,
});

const today = () => new Date().toISOString().slice(0, 10);

/** A sent quote whose validity has passed can be seen but never accepted. */
export const isExpired = (q: Quote) => q.status === "sent" && q.validUntil < today();

export type QuoteInput = { amountMinor: number; includes: string; startDate: string; validUntil: string; note: string };

/** This business's current quote on a request, whatever its state. */
export async function currentQuote(requestId: string, businessId: string): Promise<Quote | null> {
  const r = await db.get("SELECT * FROM quote WHERE request_id=? AND business_id=? ORDER BY version DESC LIMIT 1", requestId, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function listForRequest(requestId: string): Promise<Quote[]> {
  const rows = await db.all("SELECT * FROM quote WHERE request_id=? AND status IN ('sent','accepted','not_selected') ORDER BY amount_minor ASC", requestId) as Row[];
  return rows.map(fromRow);
}

export async function listForBusiness(businessId: string): Promise<(Quote & { reference: string; service: string; district: string })[]> {
  const rows = await db.all(`SELECT q.*, r.reference, r.service, r.district FROM quote q JOIN service_request r ON r.id = q.request_id
       WHERE q.business_id=? AND q.status <> 'superseded' ORDER BY q.created_at DESC`, businessId) as (Row & { reference: string; service: string; district: string })[];
  return rows.map((r) => ({ ...fromRow(r), reference: r.reference, service: r.service, district: r.district }));
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
  if (existing?.status === "not_selected") return { ok: false, reason: "The farmer has chosen another provider." };

  const now = new Date().toISOString();
  const id = randomUUID();
  const version = (existing?.version ?? 0) + 1;

  await db.tx(async (t) => {
    // Anything this business sent before is replaced, never edited.
    await t.run("UPDATE quote SET status='superseded' WHERE request_id=? AND business_id=? AND status='sent'", requestId, businessId);
    await t.run(`INSERT INTO quote (id, request_id, business_id, version, amount_minor, includes, start_date, valid_until, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, requestId, businessId, version, input.amountMinor, input.includes, input.startDate, input.validUntil, input.note, actorId, now);
    // Once anyone has quoted, the farmer's request says so.
    await t.run("UPDATE service_request SET status='quotes_sent', updated_at=? WHERE id=? AND status='awaiting_quotes'", now, requestId);
  });
  await audit(actorId, version === 1 ? "quote.sent" : "quote.revised", id, `v${version} ${input.amountMinor}`);
  return { ok: true, quote: (await getQuote(id))! };
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
export async function acceptQuote(quoteId: string, farmerId: string): Promise<AcceptResult> {
  const quote = await getQuote(quoteId);
  if (!quote) return { ok: false, reason: "That quote no longer exists." };

  const request = await getRequest(quote.requestId);
  if (!request || request.farmerId !== farmerId) return { ok: false, reason: "That quote is not on your request." };
  if (request.status === "cancelled") return { ok: false, reason: "You withdrew this request." };
  if (quote.status !== "sent") return { ok: false, reason: "That quote is no longer open." };
  if (isExpired(quote)) return { ok: false, reason: "That quote has expired. Ask the provider for a new one." };

  const now = new Date().toISOString();
  // Accepting is one decision: the frozen agreement, the losing quotes and the request's own
  // state all move together, or none of them do.
  const decided = await db.tx<AcceptResult>(async (t) => {
    const already = await t.get("SELECT 1 FROM agreement WHERE request_id=?", quote.requestId);
    // Nothing has been written yet, so returning here commits an empty transaction.
    if (already) return { ok: false, reason: "You have already accepted a quote on this request." };

    // The agreement is a frozen copy: later edits to the quote cannot change what was agreed.
    await t.run(`INSERT INTO agreement (id, request_id, quote_id, business_id, version, amount_minor, includes, start_date, accepted_by, accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`, randomUUID(), quote.requestId, quote.id, quote.businessId, quote.version, quote.amountMinor, quote.includes, quote.startDate, farmerId, now);
    await t.run("UPDATE quote SET status='accepted' WHERE id=?", quote.id);
    await t.run("UPDATE quote SET status='not_selected' WHERE request_id=? AND id<>? AND status='sent'", quote.requestId, quote.id);
    await t.run("UPDATE service_request SET status='in_progress', updated_at=? WHERE id=?", now, quote.requestId);
    return { ok: true };
  });
  if (!decided.ok) return decided;

  await audit(farmerId, "quote.accepted", quote.id, `v${quote.version} ${quote.amountMinor}`);
  // The work now exists, unscheduled. Scheduling it commits machines; see lib/jobs.ts.
  await ensureJobForAgreement(quote.requestId, quote.businessId);
  return { ok: true };
}

export async function agreementFor(requestId: string): Promise<{ businessId: string; amountMinor: number; version: number; includes: string; startDate: string } | null> {
  const r = await db.get("SELECT business_id, amount_minor, version, includes, start_date FROM agreement WHERE request_id=?", requestId) as { business_id: string; amount_minor: number; version: number; includes: string; start_date: string } | undefined;
  return r ? { businessId: r.business_id, amountMinor: r.amount_minor, version: r.version, includes: r.includes, startDate: r.start_date } : null;
}
