import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";

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

db.exec(`
CREATE TABLE IF NOT EXISTS ledger_entry (
  id TEXT PRIMARY KEY,
  txn_id TEXT NOT NULL,
  account TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT '',
  reverses_txn TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entry (account);
CREATE INDEX IF NOT EXISTS ledger_txn ON ledger_entry (txn_id);
CREATE INDEX IF NOT EXISTS ledger_ref ON ledger_entry (ref_type, ref_id);
`);

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
export function post(legs: Leg[], ref: { type: string; id: string }, reversesTxn: string | null = null): string {
  const total = legs.reduce((sum, l) => sum + l.amountMinor, 0);
  if (total !== 0) throw new UnbalancedTransaction(total);
  if (legs.some((l) => !Number.isSafeInteger(l.amountMinor))) {
    throw new Error("Ledger amounts must be whole minor units.");
  }

  const txnId = randomUUID();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ledger_entry (id, txn_id, account, amount_minor, memo, ref_type, ref_id, reverses_txn, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  for (const leg of legs) {
    insert.run(randomUUID(), txnId, leg.account, leg.amountMinor, leg.memo ?? "", ref.type, ref.id, reversesTxn, now);
  }
  return txnId;
}

/** Undoes a transaction by posting its mirror image. The original stays exactly as it was. */
export function reverse(txnId: string, reason: string): string {
  const legs = db
    .prepare("SELECT account, amount_minor FROM ledger_entry WHERE txn_id=?")
    .all(txnId) as { account: string; amount_minor: number }[];
  if (legs.length === 0) throw new Error("Nothing to reverse: no such transaction.");
  const ref = db.prepare("SELECT ref_type, ref_id FROM ledger_entry WHERE txn_id=? LIMIT 1").get(txnId) as {
    ref_type: string; ref_id: string;
  };
  return post(
    legs.map((l) => ({ account: l.account, amountMinor: -l.amount_minor, memo: reason })),
    { type: ref.ref_type, id: ref.ref_id },
    txnId,
  );
}

export function balance(account: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ledger_entry WHERE account=?").get(account) as { total: number };
  return Number(row.total);
}

export type LedgerLine = { txnId: string; account: string; amountMinor: number; memo: string; createdAt: string; reversesTxn: string | null };

export function entriesFor(refType: string, refId: string): LedgerLine[] {
  const rows = db
    .prepare(
      `SELECT txn_id, account, amount_minor, memo, created_at, reverses_txn FROM ledger_entry
       WHERE ref_type=? AND ref_id=? ORDER BY created_at ASC, account ASC`,
    )
    .all(refType, refId) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    txnId: String(r.txn_id), account: String(r.account), amountMinor: Number(r.amount_minor),
    memo: String(r.memo), createdAt: String(r.created_at),
    reversesTxn: r.reverses_txn === null ? null : String(r.reverses_txn),
  }));
}

/** Every account must sum to something explainable; the whole ledger must sum to zero. */
export function ledgerIsBalanced(): boolean {
  const row = db.prepare("SELECT COALESCE(SUM(amount_minor), 0) AS total FROM ledger_entry").get() as { total: number };
  return Number(row.total) === 0;
}
