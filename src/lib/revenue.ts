import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/**
 * What each machine earned.
 *
 * Karim's handover, 23 November 2026 (A14): "Report revenue earned per machine, net of fees and
 * attributable refunds. Where a job used several machines the allocation must reconcile, and
 * anything not allocated must be shown and excluded rather than quietly spread."
 *
 * Four decisions written into this file:
 *
 *  - **Earned means paid.** A figure here is money that has actually left Sagora to the provider: a
 *    payout release marked paid, less refunds paid back out of it. An accepted price is not revenue
 *    and a confirmed booking is not revenue, because neither has been settled and either can still
 *    turn into a refund. The handover's worked example is arithmetic on settled money.
 *  - **Nothing is spread quietly.** A job's net is divided by a stated allocation. Where the shares
 *    do not account for all of it, the difference is reported as **not allocated** and excluded
 *    from every machine's total — never nudged into the nearest one. That is the explicit ask, and
 *    it is why `allocate` below returns a remainder rather than hiding one.
 *  - **It reconciles by construction.** Per-machine figures plus the unallocated remainder equal
 *    the net exactly, in whole minor units, with no rounding drift. `allocate` uses largest
 *    remainder so the parts of a fully-allocated job add back to the whole.
 *  - **The ledger is not touched.** Everything here is a division of a net that already exists.
 *    The identity the ledger keeps — gross = fee + net — is read, never written, so a reporting
 *    mistake can make a report wrong and can never make the books wrong.
 */

/** Shares are out of ten thousand: a three-machine job does not divide into whole percents. */
export const FULL_SHARE_BP = 10_000;

export type Share = { equipmentId: string; shareBp: number; note: string };

/**
 * How one job's earnings are divided, and whether anybody said so.
 *
 * `stated` is false when nobody has recorded an allocation and the equal split below is being
 * used. Worth reporting: an equal split between a tractor and a plough is a guess, and a provider
 * deciding where to put their money should know which figures rest on one.
 */
export type Allocation = { shares: Share[]; unallocatedBp: number; stated: boolean };

/**
 * Divides ten thousand between n machines with nothing left over.
 *
 * The first few get one basis point more than the rest, which is what makes three machines come to
 * exactly 10,000 rather than 9,999 — a one-point gap would otherwise show up as a few cents
 * "not allocated" on every three-machine job, which is noise pretending to be a finding.
 */
function equalShares(equipmentIds: readonly string[]): Share[] {
  const n = equipmentIds.length;
  if (n === 0) return [];
  const base = Math.floor(FULL_SHARE_BP / n);
  const spare = FULL_SHARE_BP - base * n;
  return equipmentIds.map((equipmentId, i) => ({
    equipmentId, shareBp: base + (i < spare ? 1 : 0), note: "",
  }));
}

/** What a job's allocation actually is: what was stated, or an equal split if nothing was. */
export async function allocationFor(jobId: string, equipmentIds: readonly string[]): Promise<Allocation> {
  const rows = await db.all(`SELECT equipment_id, share_bp, note FROM revenue_allocation
       WHERE job_id=? ORDER BY equipment_id`, jobId) as
    { equipment_id: string; share_bp: number; note: string }[];

  // Only machines still on the job count. One taken off in a reschedule keeps its row — the
  // history is worth having — but it earned nothing from work it did not do.
  const stated = rows
    .filter((r) => equipmentIds.includes(r.equipment_id))
    .map((r) => ({ equipmentId: r.equipment_id, shareBp: Number(r.share_bp), note: r.note }));

  if (stated.length === 0) {
    return { shares: equalShares(equipmentIds), unallocatedBp: 0, stated: false };
  }
  const used = stated.reduce((sum, sh) => sum + sh.shareBp, 0);
  return { shares: stated, unallocatedBp: Math.max(0, FULL_SHARE_BP - used), stated: true };
}

export type Allocated = { parts: Map<string, number>; unallocatedMinor: number };

/**
 * Splits an amount by an allocation, exactly.
 *
 * Largest remainder: every machine gets the floor of its share, then the whole minor units left
 * over inside the *allocated* portion go to the machines with the largest fractional parts. The
 * difference between the allocated portion and the whole amount is the unallocated remainder, and
 * it is returned rather than absorbed.
 *
 * The guarantee, which is what A14 asks for and what the rule suite checks: the parts plus the
 * remainder equal the amount, for any shares, any amount, and any sign.
 */
export function allocate(amountMinor: number, allocation: Allocation): Allocated {
  const parts = new Map<string, number>();
  const usedBp = allocation.shares.reduce((sum, sh) => sum + sh.shareBp, 0);
  if (usedBp <= 0 || allocation.shares.length === 0) {
    return { parts, unallocatedMinor: amountMinor };
  }

  // What the allocated shares come to in total, decided first so the parts can be made to agree
  // with it rather than the other way round.
  const sign = amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(amountMinor);
  const allocatedTotal = Math.floor((magnitude * usedBp) / FULL_SHARE_BP);

  const floors = allocation.shares.map((sh) => ({
    equipmentId: sh.equipmentId,
    whole: Math.floor((magnitude * sh.shareBp) / FULL_SHARE_BP),
    remainder: (magnitude * sh.shareBp) % FULL_SHARE_BP,
  }));
  let spare = allocatedTotal - floors.reduce((sum, f) => sum + f.whole, 0);
  // Ties broken by equipment id so the same job always splits the same way: a report that moved a
  // cent between two machines on every refresh would be worse than useless.
  const order = [...floors].sort((a, b) => b.remainder - a.remainder || a.equipmentId.localeCompare(b.equipmentId));
  for (const f of order) {
    if (spare <= 0) break;
    f.whole += 1;
    spare -= 1;
  }
  for (const f of floors) parts.set(f.equipmentId, f.whole * sign);
  return { parts, unallocatedMinor: (magnitude - allocatedTotal) * sign };
}

/* ------------------------------------------------------------------ stating one */

export type AllocationInput = { equipmentId: string; shareBp: number; note?: string }[];

/**
 * Records how a job's earnings are divided.
 *
 * Shares may sum to less than the whole — a provider who can only account for 80% of a job should
 * be able to say so, and the remaining 20% then shows as not allocated. They may not sum to more:
 * that is not an allocation, it is a mistake, and accepting it would make the report add up to
 * more than the money.
 */
export async function setAllocation(
  businessId: string, actorId: string, jobId: string, input: AllocationInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const job = await db.get("SELECT id FROM job WHERE id=? AND business_id=?", jobId, businessId) as { id: string } | undefined;
  if (!job) return { ok: false, reason: "That job is not yours." };

  const onJob = (await db.all("SELECT equipment_id FROM job_asset WHERE job_id=?", jobId) as { equipment_id: string }[])
    .map((r) => r.equipment_id);
  for (const sh of input) {
    if (!onJob.includes(sh.equipmentId)) return { ok: false, reason: "That machine is not on this job." };
    if (!Number.isInteger(sh.shareBp) || sh.shareBp < 0 || sh.shareBp > FULL_SHARE_BP) {
      return { ok: false, reason: "A share has to be between 0 and 100 per cent." };
    }
  }
  const total = input.reduce((sum, sh) => sum + sh.shareBp, 0);
  if (total > FULL_SHARE_BP) {
    return { ok: false, reason: "The shares add up to more than the whole job. Reduce them until they come to 100 per cent or less." };
  }

  const now = new Date().toISOString();
  await db.tx(async (t) => {
    await t.run("DELETE FROM revenue_allocation WHERE job_id=?", jobId);
    for (const sh of input) {
      await t.run(`INSERT INTO revenue_allocation (id, job_id, equipment_id, share_bp, note, set_by, set_at)
           VALUES (?,?,?,?,?,?,?)`, randomUUID(), jobId, sh.equipmentId, sh.shareBp, sh.note ?? "", actorId, now);
    }
  });
  await audit(actorId, "revenue.allocated", jobId, `${input.length} machines, ${total}bp`);
  return { ok: true };
}

/* ------------------------------------------------------------------ the report */

export type MachineRevenue = {
  equipmentId: string;
  name: string;
  identifier: string;
  /**
   * This machine's share of the job before its own attributable refunds come off.
   *
   * Not "the payout net divided up": see the note on `revenueByMachine` for why those are
   * different numbers and why subtracting a refund from a payout net would count it twice.
   */
  netMinor: number;
  /** Refunds recorded against this machine by name. Unnamed ones are the job's and are already in `netMinor`. */
  refundMinor: number;
  /** What this machine earned: its share less its own refunds. The figure A14 asks for. */
  earnedMinor: number;
  /** How many settled jobs it is counted on, so a figure can be sanity-checked against the work. */
  jobs: number;
  /** True when at least one of its jobs rests on an assumed equal split rather than a stated one. */
  assumed: boolean;
};

export type RevenueReport = {
  machines: MachineRevenue[];
  /** Earnings on settled jobs that no machine's share accounts for. Shown, and in no machine's total. */
  unallocatedMinor: number;
  /**
   * Every settled payout's net. machines + unallocated = this, exactly, which is the reconciliation
   * A14 asks for and what `reconciles` below checks.
   */
  totalEarnedMinor: number;
  /** Sagora's fee on the same jobs, for reading the net against the gross. */
  feeMinor: number;
  /** Jobs counted. Jobs with no settled payout are not in any figure here. */
  jobs: number;
};

type SettledRow = {
  job_id: string; request_id: string; reference: string;
  net_minor: number; fee_minor: number;
};

/**
 * Revenue per machine for one provider.
 *
 * The subtlety that decides the whole calculation: **a payout's net is already net of refunds.**
 * `preparePayout` works from the money still held against the job, and a refund can only be
 * prepared while money is still held — so every refund necessarily precedes the payout and has
 * already reduced it. Subtracting refunds from the payout net would count them twice and understate
 * what the provider was paid.
 *
 * So refunds are not subtracted again. What they do instead is decide *where the loss falls*, which
 * is the part A14 actually asks for — a refund caused by the plough that left a strip undone should
 * land on the plough, not be smeared over the fleet:
 *
 *   1. Add the refunds named to a machine back on, giving what the job would have paid out had
 *      those not happened.
 *   2. Divide that by the allocation.
 *   3. Take each machine's own named refund off its share.
 *
 * The named amounts cancel, so the machines plus the unallocated remainder still come to the
 * payout net exactly. Refunds with no machine named stay the job's and are already spread by step
 * two, which is right: nobody has said they were any one machine's fault.
 */
export async function revenueByMachine(businessId: string): Promise<RevenueReport> {
  // Settled payouts only. "paid" is the status that means the money actually went.
  const settled = await db.all(`SELECT j.id AS job_id, rel.request_id, sr.reference,
         rel.net_minor, rel.fee_minor
       FROM release rel
       JOIN job j ON j.request_id = rel.request_id
       JOIN service_request sr ON sr.id = rel.request_id
       WHERE rel.kind='payout' AND rel.status='paid' AND j.business_id=?
       ORDER BY rel.paid_at`, businessId) as SettledRow[];

  const totals = new Map<string, { net: number; refund: number; jobs: number; assumed: boolean }>();
  let unallocated = 0;
  let fee = 0;
  // Summed straight off the payouts, independently of the division below. That is what makes
  // `reconciles` a real check rather than a restatement: if the allocation arithmetic ever drifts,
  // the parts stop adding up to this and the suite says so.
  let paidOut = 0;

  for (const row of settled) {
    fee += Number(row.fee_minor);
    paidOut += Number(row.net_minor);
    const assetIds = (await db.all("SELECT equipment_id FROM job_asset WHERE job_id=?", row.job_id) as { equipment_id: string }[])
      .map((r) => r.equipment_id);
    const allocation = await allocationFor(row.job_id, assetIds);

    // What was paid back to the farmer on this job, and whether it was about one machine.
    const refunds = await db.all(`SELECT gross_minor, equipment_id FROM release
         WHERE kind='refund' AND status='paid' AND request_id=?`, row.request_id) as
      { gross_minor: number; equipment_id: string | null }[];
    const named = new Map<string, number>();
    let shared = 0;
    for (const r of refunds) {
      const id = r.equipment_id ?? "";
      // A refund named to a machine that is no longer on the job cannot be attributed to it, so it
      // falls back to being the job's. Dropping it would make the total overstate the earnings.
      if (id && assetIds.includes(id)) named.set(id, (named.get(id) ?? 0) + Number(r.gross_minor));
      else shared += Number(r.gross_minor);
    }

    // Step 1: what the job would have paid out but for the refunds somebody named to a machine.
    // `shared` is deliberately not added back — an unnamed refund is the job's and belongs in every
    // machine's share, which is what leaving it inside the net achieves.
    void shared;
    const namedTotal = [...named.values()].reduce((sum, x) => sum + x, 0);
    const beforeNamed = Number(row.net_minor) + namedTotal;

    // Step 2: divide it.
    const netParts = allocate(beforeNamed, allocation);
    unallocated += netParts.unallocatedMinor;

    // Step 3: each machine carries its own.
    for (const id of assetIds) {
      const was = totals.get(id) ?? { net: 0, refund: 0, jobs: 0, assumed: false };
      was.net += netParts.parts.get(id) ?? 0;
      was.refund += named.get(id) ?? 0;
      was.jobs += 1;
      was.assumed = was.assumed || !allocation.stated;
      totals.set(id, was);
    }
  }

  if (totals.size === 0) {
    return { machines: [], unallocatedMinor: unallocated, totalEarnedMinor: paidOut, feeMinor: fee, jobs: settled.length };
  }

  const ids = [...totals.keys()];
  const marks = ids.map(() => "?").join(",");
  const rows = await db.all(`SELECT id, name, identifier FROM equipment WHERE id IN (${marks})`, ...ids) as
    { id: string; name: string; identifier: string }[];
  const byId = new Map(rows.map((e) => [e.id, e] as const));

  const machines: MachineRevenue[] = ids.map((id) => {
    const t = totals.get(id)!;
    return {
      equipmentId: id,
      name: byId.get(id)?.name ?? "Equipment",
      identifier: byId.get(id)?.identifier ?? "",
      netMinor: t.net,
      refundMinor: t.refund,
      earnedMinor: t.net - t.refund,
      jobs: t.jobs,
      assumed: t.assumed,
    };
  }).sort((a, b) => b.earnedMinor - a.earnedMinor || a.name.localeCompare(b.name));

  return {
    machines, unallocatedMinor: unallocated, totalEarnedMinor: paidOut,
    feeMinor: fee, jobs: settled.length,
  };
}

/**
 * Whether the division agrees with the money.
 *
 * The per-machine shares less their named refunds, plus whatever nobody allocated, must come to the
 * payouts actually made. `totalEarnedMinor` is summed from the payout rows rather than from these
 * parts, so this compares two independently-arrived-at figures and can genuinely fail.
 */
export const reconciles = (r: RevenueReport) =>
  r.machines.reduce((sum, m) => sum + m.earnedMinor, 0) + r.unallocatedMinor === r.totalEarnedMinor;

/** A share as a percentage, for a screen. Two decimals, because basis points have them. */
export const sharePercent = (bp: number) => Math.round((bp / FULL_SHARE_BP) * 10_000) / 100;
