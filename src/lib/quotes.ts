import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
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

db.exec(`
CREATE TABLE IF NOT EXISTS quote (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  includes TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','superseded','withdrawn','accepted','not_selected')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS quote_version ON quote (request_id, business_id, version);
CREATE INDEX IF NOT EXISTS quote_request ON quote (request_id, status);
CREATE INDEX IF NOT EXISTS quote_business ON quote (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agreement (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  quote_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  includes TEXT NOT NULL,
  start_date TEXT NOT NULL,
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
`);

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
export function currentQuote(requestId: string, businessId: string): Quote | null {
  const r = db
    .prepare("SELECT * FROM quote WHERE request_id=? AND business_id=? ORDER BY version DESC LIMIT 1")
    .get(requestId, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function listForRequest(requestId: string): Quote[] {
  const rows = db
    .prepare("SELECT * FROM quote WHERE request_id=? AND status IN ('sent','accepted','not_selected') ORDER BY amount_minor ASC")
    .all(requestId) as Row[];
  return rows.map(fromRow);
}

export function listForBusiness(businessId: string): (Quote & { reference: string; service: string; district: string })[] {
  const rows = db
    .prepare(
      `SELECT q.*, r.reference, r.service, r.district FROM quote q JOIN service_request r ON r.id = q.request_id
       WHERE q.business_id=? AND q.status <> 'superseded' ORDER BY q.created_at DESC`,
    )
    .all(businessId) as (Row & { reference: string; service: string; district: string })[];
  return rows.map((r) => ({ ...fromRow(r), reference: r.reference, service: r.service, district: r.district }));
}

export function getQuote(id: string): Quote | null {
  const r = db.prepare("SELECT * FROM quote WHERE id=?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export type SendResult = { ok: true; quote: Quote } | { ok: false; reason: string };

/**
 * Sends a quote, or replaces this business's previous one with a new version.
 * The old version is kept and marked superseded, so what the farmer saw is never rewritten.
 */
export function sendQuote(requestId: string, businessId: string, actorId: string, input: QuoteInput): SendResult {
  const request = getRequest(requestId);
  if (!request) return { ok: false, reason: "That request no longer exists." };
  if (request.status === "cancelled") return { ok: false, reason: "That request was withdrawn by the farmer." };
  if (request.status === "completed") return { ok: false, reason: "That request is already finished." };

  const existing = currentQuote(requestId, businessId);
  if (existing?.status === "accepted") return { ok: false, reason: "Your quote has already been accepted." };
  if (existing?.status === "not_selected") return { ok: false, reason: "The farmer has chosen another provider." };

  const now = new Date().toISOString();
  const id = randomUUID();
  const version = (existing?.version ?? 0) + 1;

  db.exec("BEGIN IMMEDIATE");
  try {
    // Anything this business sent before is replaced, never edited.
    db.prepare("UPDATE quote SET status='superseded' WHERE request_id=? AND business_id=? AND status='sent'")
      .run(requestId, businessId);
    db.prepare(
      `INSERT INTO quote (id, request_id, business_id, version, amount_minor, includes, start_date, valid_until, note, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, requestId, businessId, version, input.amountMinor, input.includes, input.startDate, input.validUntil, input.note, actorId, now);
    // Once anyone has quoted, the farmer's request says so.
    db.prepare("UPDATE service_request SET status='quotes_sent', updated_at=? WHERE id=? AND status='awaiting_quotes'")
      .run(now, requestId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  audit(actorId, version === 1 ? "quote.sent" : "quote.revised", id, `v${version} ${input.amountMinor}`);
  return { ok: true, quote: getQuote(id)! };
}

export function withdrawQuote(requestId: string, businessId: string, actorId: string): boolean {
  const res = db
    .prepare("UPDATE quote SET status='withdrawn' WHERE request_id=? AND business_id=? AND status='sent'")
    .run(requestId, businessId);
  if (changed(res)) audit(actorId, "quote.withdrawn", requestId);
  return changed(res) > 0;
}

export type AcceptResult = { ok: true } | { ok: false; reason: string };

/**
 * The farmer accepts one quote. In a single transaction this freezes the accepted version into
 * an agreement, marks the other providers' quotes as not selected, and moves the request on.
 * Re-running it is harmless: the unique request_id on agreement means a second accept fails.
 */
export function acceptQuote(quoteId: string, farmerId: string): AcceptResult {
  const quote = getQuote(quoteId);
  if (!quote) return { ok: false, reason: "That quote no longer exists." };

  const request = getRequest(quote.requestId);
  if (!request || request.farmerId !== farmerId) return { ok: false, reason: "That quote is not on your request." };
  if (request.status === "cancelled") return { ok: false, reason: "You withdrew this request." };
  if (quote.status !== "sent") return { ok: false, reason: "That quote is no longer open." };
  if (isExpired(quote)) return { ok: false, reason: "That quote has expired. Ask the provider for a new one." };

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const already = db.prepare("SELECT 1 FROM agreement WHERE request_id=?").get(quote.requestId);
    if (already) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "You have already accepted a quote on this request." };
    }
    // The agreement is a frozen copy: later edits to the quote cannot change what was agreed.
    db.prepare(
      `INSERT INTO agreement (id, request_id, quote_id, business_id, version, amount_minor, includes, start_date, accepted_by, accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(randomUUID(), quote.requestId, quote.id, quote.businessId, quote.version, quote.amountMinor, quote.includes, quote.startDate, farmerId, now);
    db.prepare("UPDATE quote SET status='accepted' WHERE id=?").run(quote.id);
    db.prepare("UPDATE quote SET status='not_selected' WHERE request_id=? AND id<>? AND status='sent'")
      .run(quote.requestId, quote.id);
    db.prepare("UPDATE service_request SET status='in_progress', updated_at=? WHERE id=?").run(now, quote.requestId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  audit(farmerId, "quote.accepted", quote.id, `v${quote.version} ${quote.amountMinor}`);
  // The work now exists, unscheduled. Scheduling it commits machines; see lib/jobs.ts.
  ensureJobForAgreement(quote.requestId, quote.businessId);
  return { ok: true };
}

export function agreementFor(requestId: string): { businessId: string; amountMinor: number; version: number; includes: string; startDate: string } | null {
  const r = db
    .prepare("SELECT business_id, amount_minor, version, includes, start_date FROM agreement WHERE request_id=?")
    .get(requestId) as { business_id: string; amount_minor: number; version: number; includes: string; start_date: string } | undefined;
  return r ? { businessId: r.business_id, amountMinor: r.amount_minor, version: r.version, includes: r.includes, startDate: r.start_date } : null;
}
