import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { getAsset, unavailableReason } from "./equipment";
// jobs reads service_request as well as its own tables, so the module that owns it is loaded
// here rather than left to whichever page happened to import what first.
import "./requests";

/**
 * A job is the work itself: an accepted agreement, scheduled, with specific machines and a
 * named operator committed to it.
 *
 * Rules this file exists to enforce:
 *  - "Overlapping commitments must fail." One plough cannot be on two jobs at once. The check
 *    is done inside the transaction that writes the commitment, so two providers scheduling at
 *    the same moment cannot both win.
 *  - "Work reported vs farmer-confirmed delivery" are different things, and **silence is not
 *    consent**: a job only becomes complete when the farmer says so.
 *  - A blocking fault flags the job without erasing the commitment: the machine stays assigned
 *    and the job is marked at risk, so nobody silently loses the plan.
 *
 * NOT a booking. The brief's booking decision also needs verified funds, which arrive with
 * payments in stage 4. Until then a scheduled job carries no money guarantee and says so.
 */

export type JobStatus = "unscheduled" | "scheduled" | "in_progress" | "work_reported" | "completed" | "disputed" | "cancelled";

/** Specific states, never a bare "Pending" (brief rule). */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  unscheduled: "Not scheduled yet",
  scheduled: "Scheduled",
  in_progress: "Work started",
  work_reported: "Awaiting farmer confirmation",
  completed: "Confirmed by the farmer",
  disputed: "Farmer raised a concern",
  cancelled: "Cancelled",
};

/** The states where a machine is still spoken for, so a second job may not take it. */
const HOLDING: JobStatus[] = ["scheduled", "in_progress", "work_reported"];

export type Job = {
  id: string; requestId: string; businessId: string; status: JobStatus;
  startDate: string | null; endDate: string | null; operatorId: string | null;
  workNote: string; reportedAcres: number | null; reportedAt: string | null;
  confirmedAt: string | null; concern: string; assetIds: string[];
};

type Row = {
  id: string; request_id: string; business_id: string; status: JobStatus;
  start_date: string | null; end_date: string | null; operator_id: string | null;
  work_note: string; reported_acres: number | null; reported_at: string | null;
  confirmed_at: string | null; concern: string;
};

async function fromRow(r: Row): Promise<Job> {
  const ids = await db.all("SELECT equipment_id FROM job_asset WHERE job_id=?", r.id) as { equipment_id: string }[];
  return {
    id: r.id, requestId: r.request_id, businessId: r.business_id, status: r.status,
    startDate: r.start_date, endDate: r.end_date, operatorId: r.operator_id,
    workNote: r.work_note, reportedAcres: r.reported_acres, reportedAt: r.reported_at,
    confirmedAt: r.confirmed_at, concern: r.concern, assetIds: ids.map((i) => i.equipment_id),
  };
}

/** Created the moment a quote is accepted, so the work exists before anyone schedules it. */
export async function ensureJobForAgreement(requestId: string, businessId: string): Promise<Job> {
  const existing = await db.get("SELECT * FROM job WHERE request_id=?", requestId) as Row | undefined;
  if (existing) return fromRow(existing);
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.run("INSERT OR IGNORE INTO job (id, request_id, business_id, created_at, updated_at) VALUES (?,?,?,?,?)", id, requestId, businessId, now, now);
  return fromRow(await db.get("SELECT * FROM job WHERE request_id=?", requestId) as Row);
}

export async function getJob(businessId: string, id: string): Promise<Job | null> {
  const r = await db.get("SELECT * FROM job WHERE id=? AND business_id=?", id, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function jobForRequest(requestId: string): Promise<Job | null> {
  const r = await db.get("SELECT * FROM job WHERE request_id=?", requestId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function listJobs(businessId: string): Promise<(Job & { reference: string; service: string; district: string; village: string; acres: number })[]> {
  const rows = await db.all(`SELECT j.*, r.reference, r.service, r.district, r.village, r.acres
       FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.business_id=? ORDER BY COALESCE(j.start_date, '9999') ASC, j.created_at ASC`, businessId) as (Row & { reference: string; service: string; district: string; village: string; acres: number })[];
  return Promise.all(
    rows.map(async (r) => ({ ...(await fromRow(r)), reference: r.reference, service: r.service, district: r.district, village: r.village, acres: r.acres })),
  );
}

/** Every job an asset is committed to that overlaps the window, ignoring one job being edited. */
export async function clashesFor(equipmentId: string, start: string, end: string, exceptJobId: string | null, t: Queries = db) {
  return await t.all(`SELECT j.id, r.reference, j.start_date, j.end_date
       FROM job_asset a JOIN job j ON j.id = a.job_id JOIN service_request r ON r.id = j.request_id
       WHERE a.equipment_id = ? AND j.status IN (${HOLDING.map(() => "?").join(",")})
         AND j.id <> COALESCE(?, '')
         AND j.start_date <= ? AND j.end_date >= ?`, equipmentId, ...HOLDING, exceptJobId, end, start) as { id: string; reference: string; start_date: string; end_date: string }[];
}

export type ScheduleInput = { startDate: string; endDate: string; operatorId: string | null; assetIds: string[] };
export type ScheduleResult = { ok: true } | { ok: false; reason: string };

/**
 * Commits machines and an operator to a window. The clash check runs inside the transaction,
 * so two schedules racing for the same plough cannot both succeed.
 */
export async function scheduleJob(businessId: string, actorId: string, jobId: string, input: ScheduleInput): Promise<ScheduleResult> {
  const job = await getJob(businessId, jobId);
  if (!job) return { ok: false, reason: "That job is not yours." };
  if (["completed", "cancelled", "disputed"].includes(job.status)) return { ok: false, reason: "That job is finished." };
  if (input.endDate < input.startDate) return { ok: false, reason: "The end date must be on or after the start date." };
  if (input.assetIds.length === 0) return { ok: false, reason: "Choose at least one machine." };

  // Names are collected here, before the transaction: a lookup inside it would go through the
  // shared connection that the transaction itself is holding.
  const names = new Map<string, string>();
  for (const id of input.assetIds) {
    const asset = await getAsset(businessId, id);
    if (!asset) return { ok: false, reason: "One of those machines is not on your register." };
    const why = unavailableReason(asset);
    if (why) return { ok: false, reason: `${asset.name} cannot be used: ${why.toLowerCase()}.` };
    names.set(id, asset.name);
  }

  // The clash check and the commitment are one decision: two schedules racing for the same
  // plough must not both pass the check and then both write.
  const result = await db.tx<ScheduleResult>(async (t) => {
    for (const id of input.assetIds) {
      const clash = (await clashesFor(id, input.startDate, input.endDate, jobId, t))[0];
      if (clash) {
        // Nothing written yet, so returning commits an empty transaction.
        return {
          ok: false,
          reason: `${names.get(id)} is already committed to ${clash.reference} from ${clash.start_date} to ${clash.end_date}.`,
        };
      }
    }
    await t.run("DELETE FROM job_asset WHERE job_id=?", jobId);
    const INSERT_ASSET = "INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?)";
    for (const id of input.assetIds) await t.run(INSERT_ASSET, jobId, id);
    await t.run(`UPDATE job SET start_date=?, end_date=?, operator_id=?, status=CASE WHEN status='unscheduled' THEN 'scheduled' ELSE status END, updated_at=?
       WHERE id=? AND business_id=?`, input.startDate, input.endDate, input.operatorId, new Date().toISOString(), jobId, businessId);
    return { ok: true };
  });
  if (!result.ok) return result;

  await audit(actorId, "job.scheduled", jobId, `${input.startDate}..${input.endDate}`);
  return { ok: true };
}

export async function startWork(businessId: string, actorId: string, jobId: string): Promise<boolean> {
  const res = await db.run("UPDATE job SET status='in_progress', updated_at=? WHERE id=? AND business_id=? AND status='scheduled'", new Date().toISOString(), jobId, businessId);
  if (res.changes) await audit(actorId, "job.started", jobId);
  return res.changes > 0;
}

/** The provider says what was done. This is a claim, not a delivery: the farmer decides that. */
export async function reportWork(businessId: string, actorId: string, jobId: string, acres: number, note: string): Promise<boolean> {
  const res = await db.run(`UPDATE job SET status='work_reported', reported_acres=?, work_note=?, reported_at=?, updated_at=?
       WHERE id=? AND business_id=? AND status IN ('scheduled','in_progress')`, acres, note, new Date().toISOString(), new Date().toISOString(), jobId, businessId);
  if (res.changes) await audit(actorId, "job.work_reported", jobId, `${acres} acres`);
  return res.changes > 0;
}

/* --------------------------------------------------------------- the farmer */

export type FarmerDecision = { ok: true } | { ok: false; reason: string };

/** Silence is not consent: only the farmer's explicit confirmation completes a job. */
export async function confirmDelivery(farmerId: string, requestId: string): Promise<FarmerDecision> {
  const row = await db.get(`SELECT j.id FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.request_id=? AND r.farmer_id=? AND j.status='work_reported'`, requestId, farmerId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "There is nothing to confirm on this request yet." };
  await db.run("UPDATE job SET status='completed', confirmed_at=?, updated_at=? WHERE id=?", new Date().toISOString(), new Date().toISOString(), row.id);
  await db.run("UPDATE service_request SET status='completed', updated_at=? WHERE id=?", new Date().toISOString(), requestId);
  await audit(farmerId, "job.confirmed", row.id);
  return { ok: true };
}

export async function raiseConcern(farmerId: string, requestId: string, concern: string): Promise<FarmerDecision> {
  const row = await db.get(`SELECT j.id FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.request_id=? AND r.farmer_id=? AND j.status='work_reported'`, requestId, farmerId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "There is nothing to raise a concern about yet." };
  if (concern.trim().length < 4) return { ok: false, reason: "Say what the problem is." };
  await db.run("UPDATE job SET status='disputed', concern=?, updated_at=? WHERE id=?", concern.trim(), new Date().toISOString(), row.id);
  await audit(farmerId, "job.concern_raised", row.id, concern.trim());
  return { ok: true };
}

/** Machines on this job that cannot currently work, so the job can be flagged without losing it. */
export async function atRiskAssets(businessId: string, job: Job): Promise<{ name: string; why: string }[]> {
  const out: { name: string; why: string }[] = [];
  for (const id of job.assetIds) {
    const asset = await getAsset(businessId, id);
    if (!asset) continue;
    const why = unavailableReason(asset);
    if (why) out.push({ name: asset.name, why });
  }
  return out;
}

export type FarmerBooking = Job & {
  reference: string; service: string; district: string; village: string; acres: number;
  businessName: string; businessPhone: string; amountMinor: number; assetNames: string[];
};

/**
 * What the farmer calls a booking: work they have agreed to, with the provider's name attached.
 * Their own requests only — the farmer id comes from the session, never from a form.
 */
export async function bookingsForFarmer(farmerId: string): Promise<FarmerBooking[]> {
  const rows = await db.all(`SELECT j.*, r.reference, r.service, r.district, r.village, r.acres,
              b.name AS business_name, b.phone AS business_phone, a.amount_minor
       FROM job j
       JOIN service_request r ON r.id = j.request_id
       JOIN provider_business b ON b.id = j.business_id
       LEFT JOIN agreement a ON a.request_id = j.request_id
       WHERE r.farmer_id = ?
       ORDER BY COALESCE(j.start_date, '9999') ASC, j.created_at DESC`, farmerId) as (Row & {
      reference: string; service: string; district: string; village: string; acres: number;
      business_name: string; business_phone: string; amount_minor: number | null;
    })[];

  return Promise.all(
    rows.map(async (r) => {
      const job = await fromRow(r);
      const names = await Promise.all(
        job.assetIds.map(async (id) => {
          const a = (await db.get("SELECT name FROM equipment WHERE id=?", id)) as { name: string } | undefined;
          return a?.name ?? "A machine";
        }),
      );
      return {
        ...job,
        reference: r.reference, service: r.service, district: r.district, village: r.village, acres: r.acres,
        businessName: r.business_name, businessPhone: r.business_phone,
        amountMinor: Number(r.amount_minor ?? 0), assetNames: names,
      };
    }),
  );
}

/** The four tabs the design gives the farmer's bookings list. */
export const BOOKING_TABS = [
  { id: "upcoming", label: "Upcoming", statuses: ["unscheduled", "scheduled"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress", "work_reported", "disputed"] },
  { id: "completed", label: "Completed", statuses: ["completed"] },
  { id: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
] as const;

export type BookingTab = (typeof BOOKING_TABS)[number]["id"];
