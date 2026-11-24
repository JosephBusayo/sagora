import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/**
 * A machine goes wrong; the work it was booked for does not disappear.
 *
 * Karim's handover, 23 November 2026: "A new blocking fault must flag existing bookings for action
 * rather than cancelling them silently."
 *
 * The word that matters is *silently*. Cancelling might well be the right answer — but it is the
 * provider's answer to give and the farmer's to be told, and a system that takes it on their behalf
 * leaves a farmer waiting on a tractor nobody has sent. So a blocking fault raises a flag against
 * every booking the machine is committed to, and somebody has to deal with each one: swap the
 * machine, move the dates, or cancel and say so.
 *
 * Three decisions written into this file:
 *
 *  - **Only the future is flagged.** A fault reported today says nothing about last week's
 *    ploughing, and raising a flag on finished work would turn the queue into history nobody can
 *    act on.
 *  - **One flag per cause, not per report.** Three people reporting the same broken clutch is one
 *    problem with one booking. Re-raising while a flag is open does nothing.
 *  - **Resolved, never deleted.** How a provider answered is part of the job's record and part of
 *    what a dispute would turn on.
 *
 * The same mechanism carries three other causes, because they all mean the same thing to the farmer
 * at the other end: a withdrawn share (lib/shares.ts), a lapsed lease, and a machine moved to a
 * condition that blocks it.
 */

export type FlagCause = "fault" | "lease" | "share" | "condition";

export type BookingFlag = {
  id: string; jobId: string; equipmentId: string; cause: FlagCause; reason: string;
  raisedBy: string; raisedAt: string; resolvedAt: string; resolution: string;
};

type Row = {
  id: string; job_id: string; equipment_id: string; cause: FlagCause; reason: string;
  raised_by: string; raised_at: string; resolved_by: string; resolved_at: string; resolution: string;
};

const fromRow = (r: Row): BookingFlag => ({
  id: r.id, jobId: r.job_id, equipmentId: r.equipment_id, cause: r.cause, reason: r.reason,
  raisedBy: r.raised_by, raisedAt: r.raised_at, resolvedAt: r.resolved_at, resolution: r.resolution,
});

/** Jobs a flag can still usefully be raised against: committed, not yet done. */
const LIVE = ["scheduled", "in_progress", "work_reported"] as const;

/**
 * Flags every live booking this machine is committed to.
 *
 * `onlyBusinessId` narrows it to one provider's bookings, which is what a withdrawn share needs:
 * the owner taking their tractor back should flag the borrower's work and not their own.
 *
 * Returns how many bookings were flagged, which is the number worth telling the provider: "this
 * stops three jobs" is a different conversation from "this stops none".
 */
export async function flagBookings(
  equipmentId: string, cause: FlagCause, reason: string, actorId: string, onlyBusinessId?: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const marks = LIVE.map(() => "?").join(",");
  const rows = await db.all(`SELECT DISTINCT j.id FROM job_asset a JOIN job j ON j.id = a.job_id
       WHERE a.equipment_id=? AND j.status IN (${marks})
         AND COALESCE(j.end_date, j.start_date, ?) >= ?
         AND (? = '' OR j.business_id = ?)`,
    equipmentId, ...LIVE, today, today, onlyBusinessId ?? "", onlyBusinessId ?? "") as { id: string }[];

  const now = new Date().toISOString();
  let raised = 0;
  for (const j of rows) {
    // One open flag per cause. A second report of the same broken clutch is the same problem.
    const open = await db.get(`SELECT 1 FROM booking_flag
         WHERE job_id=? AND equipment_id=? AND cause=? AND resolved_at=''`, j.id, equipmentId, cause);
    if (open) continue;
    await db.run(`INSERT INTO booking_flag (id, job_id, equipment_id, cause, reason, raised_by, raised_at)
         VALUES (?,?,?,?,?,?,?)`, randomUUID(), j.id, equipmentId, cause, reason, actorId, now);
    raised++;
  }
  if (raised) await audit(actorId, "booking.flagged", equipmentId, `${cause}: ${raised} booking(s)`);
  return raised;
}

/** Open flags on one job, so the job screen can say what has to be dealt with. */
export async function flagsForJob(jobId: string): Promise<BookingFlag[]> {
  const rows = await db.all(`SELECT * FROM booking_flag WHERE job_id=? ORDER BY resolved_at, raised_at DESC`,
    jobId) as Row[];
  return rows.map(fromRow);
}

export const openOnly = (flags: readonly BookingFlag[]) => flags.filter((f) => f.resolvedAt === "");

export type FlaggedBooking = BookingFlag & {
  reference: string; assetName: string; startDate: string | null; endDate: string | null;
};

/**
 * Every booking of this provider's that something has put in doubt, newest first.
 *
 * This is the queue the handover's "flag for action" implies: a provider opening Sagora after a
 * breakdown should find the affected jobs listed, not have to work out which ones they were.
 */
export async function openFlagsFor(businessId: string): Promise<FlaggedBooking[]> {
  const rows = await db.all(`SELECT f.*, sr.reference, e.name AS asset_name, j.start_date, j.end_date
       FROM booking_flag f
       JOIN job j ON j.id = f.job_id
       JOIN service_request sr ON sr.id = j.request_id
       JOIN equipment e ON e.id = f.equipment_id
       WHERE j.business_id=? AND f.resolved_at=''
       ORDER BY j.start_date ASC, f.raised_at DESC`, businessId) as
    (Row & { reference: string; asset_name: string; start_date: string | null; end_date: string | null })[];
  return rows.map((r) => ({
    ...fromRow(r), reference: r.reference, assetName: r.asset_name,
    startDate: r.start_date, endDate: r.end_date,
  }));
}

/** Across every provider, for staff: work the platform knows is at risk. */
export async function allOpenFlags(): Promise<(FlaggedBooking & { businessName: string })[]> {
  const rows = await db.all(`SELECT f.*, sr.reference, e.name AS asset_name, j.start_date, j.end_date,
         COALESCE(b.name,'') AS business_name
       FROM booking_flag f
       JOIN job j ON j.id = f.job_id
       JOIN service_request sr ON sr.id = j.request_id
       JOIN equipment e ON e.id = f.equipment_id
       LEFT JOIN provider_business b ON b.id = j.business_id
       WHERE f.resolved_at='' ORDER BY j.start_date ASC`) as
    (Row & { reference: string; asset_name: string; start_date: string | null; end_date: string | null; business_name: string })[];
  return rows.map((r) => ({
    ...fromRow(r), reference: r.reference, assetName: r.asset_name,
    startDate: r.start_date, endDate: r.end_date, businessName: r.business_name,
  }));
}

/**
 * Somebody has dealt with it, and said how.
 *
 * The resolution text is required rather than optional: "resolved" with no account of what was done
 * is indistinguishable from dismissing the problem, and the point of the flag was that it should not
 * be possible to make the problem go away quietly.
 */
export async function resolveFlag(
  businessId: string, actorId: string, flagId: string, resolution: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const text = resolution.trim();
  if (text.length < 3) return { ok: false, reason: "Say what you did about it." };
  const row = await db.get(`SELECT f.id FROM booking_flag f JOIN job j ON j.id = f.job_id
       WHERE f.id=? AND j.business_id=? AND f.resolved_at=''`, flagId, businessId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "That flag is not open on one of your bookings." };
  await db.run("UPDATE booking_flag SET resolved_by=?, resolved_at=?, resolution=? WHERE id=?",
    actorId, new Date().toISOString(), text, flagId);
  await audit(actorId, "booking.flag_resolved", flagId, text);
  return { ok: true };
}

/**
 * Whether a job is clear to dispatch.
 *
 * An open flag stops it, which is the whole point of raising one — but it stops it by being
 * answered, not by being waited out, and `resolveFlag` is how it is answered.
 */
export const blockedByFlags = (flags: readonly BookingFlag[]): string | null => {
  const open = openOnly(flags);
  if (open.length === 0) return null;
  return open.length === 1
    ? open[0]!.reason
    : `${open.length} problems need dealing with before this job goes out.`;
};
