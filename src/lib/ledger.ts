import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";

/**
 * A double-entry ledger.
 *
 * Brief rules: "Amounts stored as integer SLE minor units. Balanced ledger entries; corrections
 * by reversal, never edits."
 *
 * So: every movement of money is a transaction of two or more entries that sum to zero. Nothing
 * is ever updated or deleted. A mistake is corrected by posting the opposite entries, which
 * leaves both the error and the correction visible — which is the point of a ledger.
 */

/**
 * Account names are structured strings rather than a table, because every account here is
 * derived from something that already exists (a request, a business).
 *
 *  - `external:<method>`      money outside Sagora: mobile money, bank, cash
 *  - `funds:<requestId>`      money held against one job
 *  - `payable:<businessId>`   money Sagora owes a provider
 *  - `fee:platform`           Sagora's share
 *  - `refundable:<requestId>` money owed back to a farmer
 */
export const account = {
  external: (method: string) => `external:${method}`,
  funds: (requestId: string) => `funds:${requestId}`,
  payable: (businessId: string) => `payable:${businessId}`,
  refundable: (requestId: string) => `refundable:${requestId}`,
  fee: "fee:platform",
};

/** One side of a transaction. Positive is money into the account, negative is out. */
export type Leg = { account: string; amountMinor: number; memo?: string };

export class UnbalancedTransaction extends Error {
  constructor(total: number) {
    super(`Ledger transaction does not balance: the entries sum to ${total}, not 0.`);
  }
}

/**
 * Posts one balanced transaction. Caller must already be inside a database transaction when
 * this is part of a larger decision (recording a payment, confirming a booking).
 */
export async function post(
  legs: Leg[],
  ref: { type: string; id: string },
  reversesTxn: string | null = null,
  // Posting is nearly always part of a larger decision, so the caller hands in its transaction.
  // Using the shared `db` inside someone else's transaction would wait for a lock it holds.
  t: Queries = db,
): Promise<string> {
  const total = legs.reduce((sum, l) => sum + l.amountMinor, 0);
  if (total !== 0) throw new UnbalancedTransaction(total);
  if (legs.some((l) => !Number.isSafeInteger(l.amountMinor))) {
    throw new Error("Ledger amounts must be whole minor units.");
  }

  const txnId = randomUUID();
  const now = new Date().toISOString();
  const INSERT_LEG =
    `INSERT INTO ledger_entry (id, txn_id, account, amount_minor, memo, ref_type, ref_id, reverses_txn, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`;
  for (const leg of legs) {
    await t.run(INSERT_LEG, randomUUID(), txnId, leg.account, leg.amountMinor, leg.memo ?? "", ref.type, ref.id, reversesTxn, now);
  }
  return txnId;
}

/** Undoes a transaction by posting its mirror image. The original stays exactly as it was. */
export async function reverse(txnId: string, reason: string, t: Queries = db): Promise<string> {
  const legs = (await t.all("SELECT account, amount_minor FROM ledger_entry WHERE txn_id=?", txnId)) as { account: string; amount_minor: number }[];
  if (legs.length === 0) throw new Error("Nothing to reverse: no such transaction.");
  const ref = (await t.get("SELECT ref_type, ref_id FROM ledger_entry WHERE txn_id=? LIMIT 1", txnId)) as {
    ref_type: string; ref_id: string;
  };
  return post(
    legs.map((l) => ({ account: l.account, amountMinor: -l.amount_minor, memo: reason })),
    { type: ref.ref_type, id: ref.ref_id },
    txnId,
    t,
  );
}

export async function balance(account: string, t: Queries = db): Promise<number> {
  const row = (await t.get("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ledger_entry WHERE account=?", account)) as { total: number };
  return Number(row.total);
}

export type LedgerLine = { txnId: string; account: string; amountMinor: number; memo: string; createdAt: string; reversesTxn: string | null };

export async function entriesFor(refType: string, refId: string): Promise<LedgerLine[]> {
  const rows = await db.all(`SELECT txn_id, account, amount_minor, memo, created_at, reverses_txn FROM ledger_entry
       WHERE ref_type=? AND ref_id=? ORDER BY created_at ASC, account ASC`, refType, refId) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    txnId: String(r.txn_id), account: String(r.account), amountMinor: Number(r.amount_minor),
    memo: String(r.memo), createdAt: String(r.created_at),
    reversesTxn: r.reverses_txn === null ? null : String(r.reverses_txn),
  }));
}

/** Every account must sum to something explainable; the whole ledger must sum to zero. */
export async function ledgerIsBalanced(): Promise<boolean> {
  const row = await db.get("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ledger_entry") as { total: number };
  return Number(row.total) === 0;
}
