import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
import { formatAmount } from "./money";
import { audit } from "./business";
import { account, balance, post } from "./ledger";
import { agreementFor } from "./quotes";
import { clashesFor, jobForRequest } from "./jobs";
import { getById as getRequest } from "./requests";

/**
 * Phase A payments: money recorded by hand.
 *
 * The brief's plan (§6.3) is manual first, a payment provider second. A coordinator records an
 * external payment — mobile money, bank, cash — with its receipt reference, and it is labelled
 * **manual, not PSP-verified** everywhere it appears. When Monime arrives it becomes a second
 * source behind the same ledger, not a rewrite.
 *
 * The rules this file enforces:
 *  - "Booking is confirmed in one database decision: accepted terms + verified funds + machine,
 *    attachments and operator all free."
 *  - "Duplicate or out-of-order payment events must not duplicate receipts, bookings or payouts."
 *  - "Money arriving after a hold expired / capacity lost → create a 'Payment received, booking
 *    not confirmed' case. Never overbook silently."
 */

db.exec(`
CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  psp_verified INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
-- The receipt reference is the idempotency key: the same payment cannot be recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS payment_external_ref ON payment (source, external_ref);
CREATE INDEX IF NOT EXISTS payment_request ON payment (request_id);

CREATE TABLE IF NOT EXISTS booking (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exception_case (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS case_open ON exception_case (status, opened_at);
`);

export const METHODS = [
  { id: "mobile_money", label: "Mobile money" },
  { id: "bank", label: "Bank transfer" },
  { id: "cash", label: "Cash" },
] as const;

export const methodLabel = (id: string) => METHODS.find((m) => m.id === id)?.label ?? id;

export type Payment = {
  id: string; requestId: string; amountMinor: number; method: string; externalRef: string;
  source: string; pspVerified: boolean; note: string; recordedAt: string;
};

type PayRow = {
  id: string; request_id: string; amount_minor: number; method: string; external_ref: string;
  source: string; psp_verified: number; note: string; recorded_at: string;
};
const payFrom = (r: PayRow): Payment => ({
  id: r.id, requestId: r.request_id, amountMinor: r.amount_minor, method: r.method,
  externalRef: r.external_ref, source: r.source, pspVerified: r.psp_verified === 1,
  note: r.note, recordedAt: r.recorded_at,
});

export function paymentsFor(requestId: string): Payment[] {
  const rows = db.prepare("SELECT * FROM payment WHERE request_id=? ORDER BY recorded_at ASC").all(requestId) as PayRow[];
  return rows.map(payFrom);
}

/** What has actually been received against this job. */
export const fundsFor = (requestId: string) => balance(account.funds(requestId));

export type Booking = { requestId: string; businessId: string; amountMinor: number; confirmedAt: string };

export function bookingFor(requestId: string): Booking | null {
  const r = db.prepare("SELECT * FROM booking WHERE request_id=?").get(requestId) as
    | { request_id: string; business_id: string; amount_minor: number; confirmed_at: string }
    | undefined;
  return r ? { requestId: r.request_id, businessId: r.business_id, amountMinor: r.amount_minor, confirmedAt: r.confirmed_at } : null;
}

export type Case = { id: string; requestId: string; kind: string; detail: string; status: string; openedAt: string };

export function openCases(): (Case & { reference: string })[] {
  const rows = db
    .prepare(
      `SELECT c.*, r.reference FROM exception_case c JOIN service_request r ON r.id = c.request_id
       WHERE c.status='open' ORDER BY c.opened_at DESC`,
    )
    .all() as (Record<string, string> & { reference: string })[];
  return rows.map((r) => ({
    id: r.id, requestId: r.request_id, kind: r.kind, detail: r.detail, status: r.status,
    openedAt: r.opened_at, reference: r.reference,
  }));
}

function openCase(requestId: string, kind: string, detail: string) {
  // One open case of a kind per request is enough; a second would just be noise.
  const existing = db
    .prepare("SELECT id FROM exception_case WHERE request_id=? AND kind=? AND status='open'")
    .get(requestId, kind);
  if (existing) return;
  db.prepare("INSERT INTO exception_case (id, request_id, kind, detail, opened_at) VALUES (?,?,?,?,?)")
    .run(randomUUID(), requestId, kind, detail, new Date().toISOString());
}

export function resolveCase(id: string, resolution: string): boolean {
  const res = db
    .prepare("UPDATE exception_case SET status='resolved', resolved_at=?, resolution=? WHERE id=? AND status='open'")
    .run(new Date().toISOString(), resolution, id);
  return changed(res) > 0;
}

export type RecordInput = { requestId: string; amountMinor: number; method: string; externalRef: string; note: string };
export type RecordResult =
  | { ok: true; outcome: "booked" | "part_paid" | "case_opened"; message: string }
  | { ok: false; reason: string };

/**
 * Records money received and then, in the same transaction, decides whether that confirms the
 * booking. One decision, one transaction: terms agreed, funds sufficient, resources still free.
 */
export function recordPayment(staffId: string, input: RecordInput): RecordResult {
  const request = getRequest(input.requestId);
  if (!request) return { ok: false, reason: "That request no longer exists." };

  const agreement = agreementFor(input.requestId);
  if (!agreement) return { ok: false, reason: "No quote has been accepted on this request yet." };
  if (bookingFor(input.requestId)) return { ok: false, reason: "This job is already booked and paid." };

  const job = jobForRequest(input.requestId);
  if (!job) return { ok: false, reason: "There is no job for this request." };

  const ref = input.externalRef.trim();
  if (!ref) return { ok: false, reason: "Enter the receipt or transaction reference." };

  db.exec("BEGIN IMMEDIATE");
  try {
    // The receipt reference is unique, so recording the same payment twice is refused here
    // rather than quietly doubling the money.
    try {
      db.prepare(
        `INSERT INTO payment (id, request_id, amount_minor, method, external_ref, note, recorded_by, recorded_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(randomUUID(), input.requestId, input.amountMinor, input.method, ref, input.note, staffId, new Date().toISOString());
    } catch {
      db.exec("ROLLBACK");
      return { ok: false, reason: `A payment with reference "${ref}" has already been recorded.` };
    }

    // Money moves from outside Sagora into funds held against this job.
    post(
      [
        { account: account.external(input.method), amountMinor: -input.amountMinor, memo: `Received ${ref}` },
        { account: account.funds(input.requestId), amountMinor: input.amountMinor, memo: `Payment for ${request.reference}` },
      ],
      { type: "request", id: input.requestId },
    );

    const held = balance(account.funds(input.requestId));
    if (held < agreement.amountMinor) {
      db.exec("COMMIT");
      audit(staffId, "payment.recorded", input.requestId, `${input.amountMinor} of ${agreement.amountMinor}`);
      return {
        ok: true,
        outcome: "part_paid",
        message: `Recorded. ${formatAmount(held)} of ${formatAmount(agreement.amountMinor)} received; the booking is not confirmed yet.`,
      };
    }

    // Funds are enough. The booking also needs the machines to still be free for these dates.
    if (!job.startDate || !job.endDate || job.assetIds.length === 0) {
      openCase(input.requestId, "payment_received_booking_not_confirmed", "Paid in full, but the work is not scheduled yet.");
      db.exec("COMMIT");
      audit(staffId, "payment.case_opened", input.requestId, "not scheduled");
      return {
        ok: true,
        outcome: "case_opened",
        message: "Paid in full, but this job has no dates or machines yet, so it is not booked. A case has been opened.",
      };
    }

    for (const assetId of job.assetIds) {
      const clash = clashesFor(assetId, job.startDate, job.endDate, job.id)[0];
      if (clash) {
        openCase(
          input.requestId,
          "payment_received_booking_not_confirmed",
          `Paid in full, but a machine is now committed to ${clash.reference} for these dates.`,
        );
        db.exec("COMMIT");
        audit(staffId, "payment.case_opened", input.requestId, `clash with ${clash.reference}`);
        return {
          ok: true,
          outcome: "case_opened",
          message: `Paid in full, but a machine is now committed to ${clash.reference}. The money is held and a case has been opened — nothing was overbooked.`,
        };
      }
    }

    db.prepare(
      "INSERT INTO booking (id, request_id, job_id, business_id, amount_minor, confirmed_at, confirmed_by) VALUES (?,?,?,?,?,?,?)",
    ).run(randomUUID(), input.requestId, job.id, agreement.businessId, agreement.amountMinor, new Date().toISOString(), staffId);
    db.exec("COMMIT");
    audit(staffId, "booking.confirmed", input.requestId, String(agreement.amountMinor));
    return { ok: true, outcome: "booked", message: "Paid in full and booked. The machines are confirmed for those dates." };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Agreements with money still owed, for the staff payments screen. */
export function awaitingPayment(): {
  requestId: string; reference: string; businessName: string; amountMinor: number; receivedMinor: number; booked: boolean;
}[] {
  const rows = db
    .prepare(
      `SELECT a.request_id, a.amount_minor, r.reference, b.name AS business_name
       FROM agreement a JOIN service_request r ON r.id = a.request_id
       JOIN provider_business b ON b.id = a.business_id
       ORDER BY a.accepted_at DESC`,
    )
    .all() as { request_id: string; amount_minor: number; reference: string; business_name: string }[];
  return rows.map((r) => ({
    requestId: r.request_id,
    reference: r.reference,
    businessName: r.business_name,
    amountMinor: Number(r.amount_minor),
    receivedMinor: fundsFor(r.request_id),
    booked: Boolean(bookingFor(r.request_id)),
  }));
}
