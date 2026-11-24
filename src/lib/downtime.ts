import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { getAsset } from "./equipment";
import type { DowntimeKind } from "./downtime-kinds";

/**
 * A machine deliberately out of action, with an end date.
 *
 * Karim's handover, 23 November 2026: "Move Record downtime and Record private work inside
 * Equipment. Private work recorded outside the booking flow is a second source of scheduling
 * truth."
 *
 * Private work already lived in the booking flow — it is a job with a private customer — so that
 * half was a move rather than a build. Downtime had nowhere to go at all, and the gap it left was
 * a real one: a provider putting a tractor in for a service either marked its condition `repair`,
 * which blocks it indefinitely with no end date and no plan, or left it available and let it be
 * double-booked.
 *
 * The distinction that makes this worth a table of its own: a **condition** is a statement about
 * the machine now, and **downtime** is a statement about a span of days. Only the second can
 * answer "is it free on the 15th?", which is the question every capacity check actually asks.
 *
 * It blocks through `clashesFor` in lib/holds.ts, alongside live holds and committed jobs, so one
 * machine has one availability answer however the question is put.
 */

// One list, in a pure module the forms can import too. See lib/downtime-kinds.ts.
export { DOWNTIME_KINDS, downtimeLabel, isDowntimeKind, type DowntimeKind } from "./downtime-kinds";

export type Downtime = {
  id: string; equipmentId: string; kind: DowntimeKind; fromDate: string; toDate: string;
  reason: string; cancelledAt: string; recordedBy: string; recordedAt: string;
};

type Row = {
  id: string; equipment_id: string; business_id: string; kind: DowntimeKind;
  from_date: string; to_date: string; reason: string;
  cancelled_at: string; cancelled_by: string; recorded_by: string; recorded_at: string;
};

const fromRow = (r: Row): Downtime => ({
  id: r.id, equipmentId: r.equipment_id, kind: r.kind, fromDate: r.from_date, toDate: r.to_date,
  reason: r.reason, cancelledAt: r.cancelled_at, recordedBy: r.recorded_by, recordedAt: r.recorded_at,
});

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export type DowntimeInput = { equipmentId: string; kind: DowntimeKind; fromDate: string; toDate: string; reason: string };

/**
 * Books a machine out for a span of days.
 *
 * Refused when the machine is already committed over those days, because the alternative is worse:
 * silently accepting it would leave a farmer with a booking and the provider with a machine on a
 * ramp, and nobody told. The provider is shown what is in the way and can move the booking first.
 */
export async function recordDowntime(
  businessId: string, actorId: string, input: DowntimeInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const asset = await getAsset(businessId, input.equipmentId);
  if (!asset) return { ok: false, reason: "That machine is not on your register." };
  if (!isDate(input.fromDate) || !isDate(input.toDate)) return { ok: false, reason: "Give a start and an end date." };
  if (input.toDate < input.fromDate) return { ok: false, reason: "The end date must be on or after the start date." };
  if (input.reason.trim().length > 200) return { ok: false, reason: "Use 200 characters or fewer." };

  // The same check a quote goes through, asked about this one machine. Downtime is not padded with
  // travel: a machine on a ramp is on a ramp for exactly the days it is booked out for, and adding
  // travel to it would block days nobody asked to block.
  const { clashesFor } = await import("./holds");
  const clash = (await clashesFor(
    [{ kind: "equipment", resourceId: input.equipmentId, label: asset.name }],
    { from: input.fromDate, to: input.toDate }, null, businessId,
  ))[0];
  if (clash) {
    return {
      ok: false,
      reason: `${asset.name} is ${clash.why}. Move that work before booking the machine out, ` +
        "or choose other days.",
    };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO asset_downtime (id, equipment_id, business_id, kind, from_date, to_date,
       reason, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    id, input.equipmentId, businessId, input.kind, input.fromDate, input.toDate,
    input.reason.trim(), actorId, now);
  await audit(actorId, "equipment.downtime", input.equipmentId, `${input.kind} ${input.fromDate}..${input.toDate}`);
  return { ok: true, id };
}

/** Calls it off. Cancelled rather than deleted: a machine's availability history is evidence. */
export async function cancelDowntime(businessId: string, actorId: string, id: string): Promise<boolean> {
  // Read the machine before the update, because the audit entry is filed against the *machine*
  // rather than the downtime row. That is what puts it on the machine's assignment activity, which
  // is where a provider looks — filing it under the downtime id, as the first version did, meant
  // calling downtime off left no trace anywhere anybody would see it.
  const row = await db.get(`SELECT equipment_id FROM asset_downtime
       WHERE id=? AND business_id=? AND cancelled_at=''`, id, businessId) as { equipment_id: string } | undefined;
  if (!row) return false;

  const res = await db.run(`UPDATE asset_downtime SET cancelled_at=?, cancelled_by=?
       WHERE id=? AND business_id=? AND cancelled_at=''`, new Date().toISOString(), actorId, id, businessId);
  if (res.changes) await audit(actorId, "equipment.downtime_cancelled", row.equipment_id, id);
  return res.changes > 0;
}

/** Everything booked for one machine, cancelled spans included so the history reads straight. */
export async function downtimeFor(businessId: string, equipmentId: string): Promise<Downtime[]> {
  const rows = await db.all(`SELECT * FROM asset_downtime WHERE business_id=? AND equipment_id=?
       ORDER BY from_date DESC`, businessId, equipmentId) as Row[];
  return rows.map(fromRow);
}

/** Live downtime overlapping a window, for the capacity check. Takes the caller's transaction. */
export async function downtimeClash(
  equipmentId: string, from: string, to: string, t: Queries = db,
): Promise<{ fromDate: string; toDate: string; kind: DowntimeKind } | null> {
  const r = await t.get(`SELECT from_date, to_date, kind FROM asset_downtime
       WHERE equipment_id=? AND cancelled_at='' AND from_date <= ? AND to_date >= ? LIMIT 1`,
    equipmentId, to, from) as { from_date: string; to_date: string; kind: DowntimeKind } | undefined;
  return r ? { fromDate: r.from_date, toDate: r.to_date, kind: r.kind } : null;
}

/** Whether a machine is booked out today, for a register screen. */
export const bookedOutOn = (spans: readonly Downtime[], on: string) =>
  spans.find((d) => d.cancelledAt === "" && d.fromDate <= on && d.toDate >= on) ?? null;
