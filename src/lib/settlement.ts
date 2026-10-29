import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { account, balance, post, reverse } from "./ledger";
import { agreementFor } from "./quotes";
import { jobForRequest } from "./jobs";
import { bookingFor } from "./payments";

/**
 * Money going out: payouts to providers and refunds to farmers.
 *
 * Brief rules this file enforces:
 *  - "Every money release: one preparer and a different approver. Changing amount or beneficiary
 *    invalidates approval."
 *  - "Keep distinct: work reported vs farmer-confirmed delivery vs disputes vs payout vs refund.
 *    Silence is not consent." — so a payout needs the farmer's confirmation, not a report and a
 *    wait, and a disputed job cannot be paid out at all.
 *  - Corrections by reversal: a release that was wrong is voided by reversing its posting, never
 *    by editing it.
 */

/**
 * The pilot fee policy from the brief: 10%, waived for the first 20 jobs. It is NOT approved yet
 * (§6.3 asks for a signed policy sheet), so `percent` is 0 and nothing is deducted. The maths is
 * built and tested; when Karim approves the sheet, `approved` becomes true and the rate applies.
 */
export const FEE_POLICY = { approved: false, pilotPercent: 10, freeJobs: 20 };

/** The fee on one release. Rounds down to whole minor units so the provider is never short-paid. */
export function feeFor(grossMinor: number, completedJobsSoFar: number): number {
  if (!FEE_POLICY.approved) return 0;
  if (completedJobsSoFar < FEE_POLICY.freeJobs) return 0;
  return Math.floor((grossMinor * FEE_POLICY.pilotPercent) / 100);
}

export type Destination = { method: string; accountName: string; accountRef: string; bank: string; updatedAt: string };

export async function destinationFor(businessId: string): Promise<Destination | null> {
  const r = await db.get("SELECT * FROM payout_destination WHERE business_id=?", businessId) as
    | { method: string; account_name: string; account_ref: string; bank: string; updated_at: string }
    | undefined;
  return r
    ? { method: r.method, accountName: r.account_name, accountRef: r.account_ref, bank: r.bank, updatedAt: r.updated_at }
    : null;
}

/**
 * Sets where a provider's money goes. The brief's rule — "changing amount or beneficiary
 * invalidates approval" — means an approved payout that has not been sent must go back for
 * approval when the destination changes underneath it.
 */
export async function setDestination(businessId: string, actorId: string, input: Omit<Destination, "updatedAt">): Promise<Outcome> {
  if (!input.accountName.trim()) return { ok: false, reason: "Enter the name on the account." };
  if (!input.accountRef.trim()) return { ok: false, reason: "Enter the number the money should go to." };

  await db.tx(async (t) => {
    const approved = (await t.all("SELECT id, owed_txn FROM release WHERE kind='payout' AND beneficiary=? AND status='approved'", businessId)) as { id: string; owed_txn: string | null }[];
    for (const r of approved) {
      if (r.owed_txn) await reverse(r.owed_txn, "Payout destination changed, approval withdrawn", t);
      await t.run("UPDATE release SET status='prepared', approved_by=NULL, approved_at=NULL, owed_txn=NULL WHERE id=?", r.id);
    }
    await t.run(`INSERT INTO payout_destination (business_id, method, account_name, account_ref, bank, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(business_id) DO UPDATE SET
         method=excluded.method, account_name=excluded.account_name, account_ref=excluded.account_ref,
         bank=excluded.bank, updated_by=excluded.updated_by, updated_at=excluded.updated_at`, businessId, input.method, input.accountName.trim(), input.accountRef.trim(), input.bank.trim(), actorId, new Date().toISOString());
  });
  await audit(actorId, "payout.destination", businessId, input.method);
  return { ok: true };
}

/** Every job's money for one provider, for their own payments screen. */
export async function earningsFor(businessId: string): Promise<{
  requestId: string; reference: string; service: string; amountMinor: number; receivedMinor: number;
  jobStatus: string; release: Release | null;
}[]> {
  const rows = await db.all(`SELECT a.request_id, a.amount_minor, r.reference, r.service, COALESCE(j.status,'unscheduled') AS job_status,
              (SELECT COALESCE(SUM(l.amount_minor),0) FROM ledger_entry l WHERE l.account = 'funds:' || a.request_id) AS held,
              (SELECT COALESCE(SUM(p.amount_minor),0) FROM payment p WHERE p.request_id = a.request_id) AS received
       FROM agreement a JOIN service_request r ON r.id = a.request_id
       LEFT JOIN job j ON j.request_id = a.request_id
       WHERE a.business_id = ? ORDER BY a.accepted_at DESC`, businessId) as {
      request_id: string; amount_minor: number; reference: string; service: string;
      job_status: string; held: number; received: number;
    }[];
  return Promise.all(
    rows.map(async (r) => ({
      requestId: r.request_id,
      reference: r.reference,
      service: r.service,
      amountMinor: Number(r.amount_minor),
      receivedMinor: Number(r.received),
      jobStatus: r.job_status,
      release: (await releasesFor(r.request_id)).find((x) => x.kind === "payout" && x.status !== "void") ?? null,
    })),
  );
}

export type ReleaseStatus = "prepared" | "approved" | "paid" | "void";

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  prepared: "Waiting for a second approver",
  approved: "Approved, not yet sent",
  paid: "Sent",
  void: "Cancelled",
};

export type Release = {
  id: string; kind: "payout" | "refund"; requestId: string;
  beneficiary: string; beneficiaryLabel: string;
  grossMinor: number; feeMinor: number; netMinor: number;
  reason: string; status: ReleaseStatus; method: string; externalRef: string;
  preparedBy: string; preparedAt: string; approvedBy: string | null; paidAt: string | null;
};

type Row = {
  id: string; kind: "payout" | "refund"; request_id: string; beneficiary: string;
  beneficiary_label: string; gross_minor: number; fee_minor: number; net_minor: number;
  reason: string; status: ReleaseStatus; method: string; external_ref: string;
  prepared_by: string; prepared_at: string; approved_by: string | null; paid_at: string | null;
  owed_txn: string | null; paid_txn: string | null;
};

const fromRow = (r: Row): Release => ({
  id: r.id, kind: r.kind, requestId: r.request_id, beneficiary: r.beneficiary,
  beneficiaryLabel: r.beneficiary_label, grossMinor: Number(r.gross_minor),
  feeMinor: Number(r.fee_minor), netMinor: Number(r.net_minor), reason: r.reason,
  status: r.status, method: r.method, externalRef: r.external_ref,
  preparedBy: r.prepared_by, preparedAt: r.prepared_at, approvedBy: r.approved_by, paidAt: r.paid_at,
});

export async function getRelease(id: string): Promise<Release | null> {
  const r = await db.get("SELECT * FROM release WHERE id=?", id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function releasesFor(requestId: string): Promise<Release[]> {
  const rows = await db.all("SELECT * FROM release WHERE request_id=? ORDER BY prepared_at ASC", requestId) as Row[];
  return rows.map(fromRow);
}

/** The finance queue: everything prepared or approved but not yet sent. */
export async function pendingReleases(): Promise<(Release & { reference: string })[]> {
  const rows = await db.all(`SELECT x.*, r.reference FROM release x JOIN service_request r ON r.id = x.request_id
       WHERE x.status IN ('prepared','approved') ORDER BY x.prepared_at ASC`,) as (Row & { reference: string })[];
  return rows.map((r) => ({ ...fromRow(r), reference: r.reference }));
}

export type Outcome<T = undefined> = { ok: true; value?: T } | { ok: false; reason: string };

/** How many jobs this provider has already been paid out for — the fee waiver counts these. */
const paidJobCount = async (businessId: string): Promise<number> => {
  const row = (await db.get("SELECT COUNT(*) AS n FROM release WHERE kind='payout' AND status='paid' AND beneficiary=?", businessId)) as { n: number };
  return Number(row.n);
};

/**
 * Prepares a payout. The provider gets paid once the farmer has confirmed the work — not when the
 * provider reports it, and never while a concern is open.
 */
export async function preparePayout(preparerId: string, requestId: string): Promise<Outcome<string>> {
  const agreement = await agreementFor(requestId);
  if (!agreement) return { ok: false, reason: "There is no agreement on this request." };
  if (!(await bookingFor(requestId))) return { ok: false, reason: "This job was never booked and paid, so there is nothing to pay out." };

  const job = await jobForRequest(requestId);
  if (!job) return { ok: false, reason: "There is no job for this request." };
  if (job.status === "disputed") return { ok: false, reason: "The farmer has raised a concern. Settle that before any payout." };
  if (job.status !== "completed") {
    return { ok: false, reason: "The farmer has not confirmed delivery yet. A reported job is not a confirmed one." };
  }

  const held = await balance(account.funds(requestId));
  if (held <= 0) return { ok: false, reason: "No money is held against this job." };

  const business = (await db.get("SELECT name FROM provider_business WHERE id=?", agreement.businessId)) as
    | { name: string }
    | undefined;

  const gross = Math.min(held, agreement.amountMinor);
  const fee = feeFor(gross, await paidJobCount(agreement.businessId));
  const id = randomUUID();
  try {
    await db.run(`INSERT INTO release (id, kind, request_id, beneficiary, beneficiary_label, gross_minor, fee_minor, net_minor, prepared_by, prepared_at)
       VALUES (?,'payout',?,?,?,?,?,?,?,?)`, id, requestId, agreement.businessId, business?.name ?? "Provider", gross, fee, gross - fee, preparerId, new Date().toISOString());
  } catch {
    return { ok: false, reason: "A payout for this job has already been prepared." };
  }
  await audit(preparerId, "payout.prepared", requestId, String(gross));
  return { ok: true, value: id };
}

/** Prepares a refund to the farmer, up to the money still held against the job. */
export async function prepareRefund(preparerId: string, requestId: string, amountMinor: number, reason: string): Promise<Outcome<string>> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, reason: "Enter an amount to refund." };
  if (!reason.trim()) return { ok: false, reason: "Say why this is being refunded." };

  const held = await balance(account.funds(requestId));
  if (amountMinor > held) {
    return { ok: false, reason: "That is more than the money still held against this job." };
  }
  const farmer = await db.get(`SELECT u.name AS name, u.email AS email FROM service_request r JOIN user u ON u.id = r.farmer_id WHERE r.id=?`, requestId) as { name: string; email: string } | undefined;

  const id = randomUUID();
  try {
    await db.run(`INSERT INTO release (id, kind, request_id, beneficiary, beneficiary_label, gross_minor, net_minor, reason, prepared_by, prepared_at)
       VALUES (?,'refund',?,?,?,?,?,?,?,?)`, id, requestId, farmer?.email ?? "", farmer?.name ?? "Farmer", amountMinor, amountMinor, reason.trim(), preparerId, new Date().toISOString());
  } catch {
    return { ok: false, reason: "A refund for this job is already in progress." };
  }
  await audit(preparerId, "refund.prepared", requestId, String(amountMinor));
  return { ok: true, value: id };
}

/**
 * The second person signs it off. Approval records who, so "preparer ≠ approver" is enforced on
 * the row rather than trusted to a screen, and the money owed is posted at that moment.
 */
export async function approveRelease(approverId: string, id: string): Promise<Outcome> {
  const release = await getRelease(id);
  if (!release) return { ok: false, reason: "That release no longer exists." };
  if (release.status !== "prepared") return { ok: false, reason: "That release is not waiting for approval." };
  if (release.preparedBy === approverId) {
    return { ok: false, reason: "The person who prepared a release cannot approve it. Someone else must." };
  }

  await db.tx(async (t) => {
    const owed =
      release.kind === "payout"
        ? await post(
            [
              { account: account.funds(release.requestId), amountMinor: -release.grossMinor, memo: "Approved for payout" },
              ...(release.feeMinor > 0 ? [{ account: account.fee, amountMinor: release.feeMinor, memo: "Platform fee" }] : []),
              { account: account.payable(release.beneficiary), amountMinor: release.netMinor, memo: "Owed to provider" },
            ],
            { type: "release", id },
            null,
            t,
          )
        : await post(
            [
              { account: account.funds(release.requestId), amountMinor: -release.grossMinor, memo: "Approved for refund" },
              { account: account.refundable(release.requestId), amountMinor: release.grossMinor, memo: release.reason },
            ],
            { type: "release", id },
            null,
            t,
          );

    const res = await t.run("UPDATE release SET status='approved', approved_by=?, approved_at=?, owed_txn=? WHERE id=? AND status='prepared'", approverId, new Date().toISOString(), owed, id);
    // Somebody else moved it while we were deciding: roll the posting back with it.
    if (res.changes === 0) throw new Error("release changed under us");
  });
  await audit(approverId, `${release.kind}.approved`, release.requestId, String(release.netMinor));
  return { ok: true };
}

/**
 * Changing the amount sends it back for approval. The brief: "changing amount or beneficiary
 * invalidates approval."
 */
export async function reviseAmount(actorId: string, id: string, amountMinor: number): Promise<Outcome> {
  const release = await getRelease(id);
  if (!release) return { ok: false, reason: "That release no longer exists." };
  if (release.status === "paid") return { ok: false, reason: "That has already been sent. Reverse it instead." };
  if (release.status === "void") return { ok: false, reason: "That release was cancelled." };
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, reason: "Enter an amount." };

  const fee = release.kind === "payout" ? feeFor(amountMinor, await paidJobCount(release.beneficiary)) : 0;
  await db.tx(async (t) => {
    // An approved release already posted what it owes; undo that posting before the amount moves.
    if (release.status === "approved") {
      const row = (await t.get("SELECT owed_txn FROM release WHERE id=?", id)) as { owed_txn: string | null };
      if (row.owed_txn) await reverse(row.owed_txn, "Amount changed, approval withdrawn", t);
    }
    await t.run(`UPDATE release SET gross_minor=?, fee_minor=?, net_minor=?, status='prepared',
         approved_by=NULL, approved_at=NULL, owed_txn=NULL WHERE id=?`, amountMinor, fee, amountMinor - fee, id);
  });
  await audit(actorId, `${release.kind}.revised`, release.requestId, String(amountMinor));
  return { ok: true };
}

/** Records that the money actually left — the transfer reference is the proof. */
export async function markSent(actorId: string, id: string, method: string, externalRef: string): Promise<Outcome> {
  const release = await getRelease(id);
  if (!release) return { ok: false, reason: "That release no longer exists." };
  if (release.status !== "approved") return { ok: false, reason: "That release has not been approved yet." };
  const ref = externalRef.trim();
  if (!ref) return { ok: false, reason: "Enter the transfer reference." };

  await db.tx(async (t) => {
    const from = release.kind === "payout" ? account.payable(release.beneficiary) : account.refundable(release.requestId);
    const paid = await post(
      [
        { account: from, amountMinor: -release.netMinor, memo: `Sent ${ref}` },
        { account: account.external(method), amountMinor: release.netMinor, memo: `Sent to ${release.beneficiaryLabel}` },
      ],
      { type: "release", id },
      null,
      t,
    );
    const res = await t.run("UPDATE release SET status='paid', paid_at=?, method=?, external_ref=?, paid_txn=? WHERE id=? AND status='approved'", new Date().toISOString(), method, ref, paid, id);
    if (res.changes === 0) throw new Error("release changed under us");
  });
  await audit(actorId, `${release.kind}.sent`, release.requestId, ref);
  return { ok: true };
}

/** Cancels a release that has not been sent. An approved one has its posting reversed. */
export async function voidRelease(actorId: string, id: string, reason: string): Promise<Outcome> {
  const release = await getRelease(id);
  if (!release) return { ok: false, reason: "That release no longer exists." };
  if (release.status === "paid") return { ok: false, reason: "That has already been sent. Reverse it instead." };
  if (release.status === "void") return { ok: true };

  await db.tx(async (t) => {
    const row = (await t.get("SELECT owed_txn FROM release WHERE id=?", id)) as { owed_txn: string | null };
    if (row.owed_txn) await reverse(row.owed_txn, reason || "Release cancelled", t);
    await t.run("UPDATE release SET status='void', owed_txn=NULL, reason=? WHERE id=?", reason, id);
  });
  await audit(actorId, `${release.kind}.void`, release.requestId, reason);
  return { ok: true };
}

export type Transaction = {
  id: string; reference: string; requestId: string; kind: "payment" | "refund";
  amountMinor: number; at: string; status: string; method: string;
};

/**
 * One farmer's money, as the design's transactions table wants it: an id, a type, an amount, a
 * date and a status. Payments they made and refunds they were sent, newest first.
 */
export async function transactionsFor(farmerId: string): Promise<Transaction[]> {
  const paid = await db.all(`SELECT p.external_ref AS id, r.reference, r.id AS request_id, p.amount_minor, p.recorded_at, p.method
       FROM payment p JOIN service_request r ON r.id = p.request_id WHERE r.farmer_id = ?`, farmerId) as {
      id: string; reference: string; request_id: string; amount_minor: number; recorded_at: string; method: string;
    }[];

  const refunds = await db.all(`SELECT x.id, x.external_ref, r.reference, r.id AS request_id, x.net_minor, x.status, x.method,
              COALESCE(x.paid_at, x.prepared_at) AS at
       FROM release x JOIN service_request r ON r.id = x.request_id
       WHERE x.kind = 'refund' AND x.status <> 'void' AND r.farmer_id = ?`, farmerId) as {
      id: string; external_ref: string; reference: string; request_id: string;
      net_minor: number; status: ReleaseStatus; method: string; at: string;
    }[];

  const rows: Transaction[] = [
    ...paid.map((p) => ({
      id: p.id, reference: p.reference, requestId: p.request_id, kind: "payment" as const,
      amountMinor: Number(p.amount_minor), at: p.recorded_at, status: "Received", method: p.method,
    })),
    ...refunds.map((r) => ({
      id: r.external_ref || r.id.slice(0, 8).toUpperCase(), reference: r.reference, requestId: r.request_id,
      kind: "refund" as const, amountMinor: -Number(r.net_minor), at: r.at,
      status: r.status === "paid" ? "Sent to you" : "Being processed", method: r.method,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export type Reconciliation = {
  balanced: boolean;
  heldMinor: number;
  payableMinor: number;
  refundableMinor: number;
  feeMinor: number;
  externalMinor: number;
  heldAfterCompletion: { reference: string; requestId: string; amountMinor: number }[];
  negativeAccounts: { account: string; amountMinor: number }[];
};

/**
 * The finance check: does the ledger still add up, and is any money sitting somewhere it should
 * not be? A balanced ledger with money held against a finished job is still a problem — it means
 * someone has not been paid.
 */
export async function reconcile(): Promise<Reconciliation> {
  const sumLike = async (prefix: string) => {
    const row = (await db.get("SELECT COALESCE(SUM(amount_minor),0) AS total FROM ledger_entry WHERE account LIKE ?", `${prefix}%`)) as { total: number };
    return Number(row.total);
  };

  const held = await db.all(`SELECT r.id, r.reference, SUM(l.amount_minor) AS total
       FROM ledger_entry l JOIN service_request r ON ('funds:' || r.id) = l.account
       JOIN job j ON j.request_id = r.id
       WHERE j.status IN ('completed','cancelled')
       GROUP BY r.id HAVING SUM(l.amount_minor) <> 0`,) as { id: string; reference: string; total: number }[];

  const negative = await db.all(`SELECT account, SUM(amount_minor) AS total FROM ledger_entry
       WHERE account LIKE 'funds:%' OR account LIKE 'payable:%' OR account LIKE 'refundable:%'
       GROUP BY account HAVING SUM(amount_minor) < 0`,) as { account: string; total: number }[];

  return {
    balanced: (await sumLike("")) === 0,
    heldMinor: await sumLike("funds:"),
    payableMinor: await sumLike("payable:"),
    refundableMinor: await sumLike("refundable:"),
    feeMinor: await sumLike("fee:"),
    externalMinor: await sumLike("external:"),
    heldAfterCompletion: held.map((h) => ({ reference: h.reference, requestId: h.id, amountMinor: Number(h.total) })),
    negativeAccounts: negative.map((n) => ({ account: n.account, amountMinor: Number(n.total) })),
  };
}
