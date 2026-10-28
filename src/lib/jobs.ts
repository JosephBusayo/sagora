import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
import { audit } from "./business";
import { getAsset, unavailableReason } from "./equipment";

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

db.exec(`
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unscheduled'
    CHECK (status IN ('unscheduled','scheduled','in_progress','work_reported','completed','disputed','cancelled')),
  start_date TEXT,
  end_date TEXT,
  operator_id TEXT,
  work_note TEXT NOT NULL DEFAULT '',
  reported_acres REAL,
  reported_at TEXT,
  confirmed_at TEXT,
  concern TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_business ON job (business_id, status);

CREATE TABLE IF NOT EXISTS job_asset (
  job_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  PRIMARY KEY (job_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS job_asset_equipment ON job_asset (equipment_id);
`);

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

function fromRow(r: Row): Job {
  const ids = db.prepare("SELECT equipment_id FROM job_asset WHERE job_id=?").all(r.id) as { equipment_id: string }[];
  return {
    id: r.id, requestId: r.request_id, businessId: r.business_id, status: r.status,
    startDate: r.start_date, endDate: r.end_date, operatorId: r.operator_id,
    workNote: r.work_note, reportedAcres: r.reported_acres, reportedAt: r.reported_at,
    confirmedAt: r.confirmed_at, concern: r.concern, assetIds: ids.map((i) => i.equipment_id),
  };
}

/** Created the moment a quote is accepted, so the work exists before anyone schedules it. */
export function ensureJobForAgreement(requestId: string, businessId: string): Job {
  const existing = db.prepare("SELECT * FROM job WHERE request_id=?").get(requestId) as Row | undefined;
  if (existing) return fromRow(existing);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare("INSERT OR IGNORE INTO job (id, request_id, business_id, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(id, requestId, businessId, now, now);
  return fromRow(db.prepare("SELECT * FROM job WHERE request_id=?").get(requestId) as Row);
}

export function getJob(businessId: string, id: string): Job | null {
  const r = db.prepare("SELECT * FROM job WHERE id=? AND business_id=?").get(id, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function jobForRequest(requestId: string): Job | null {
  const r = db.prepare("SELECT * FROM job WHERE request_id=?").get(requestId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function listJobs(businessId: string): (Job & { reference: string; service: string; district: string; village: string; acres: number })[] {
  const rows = db
    .prepare(
      `SELECT j.*, r.reference, r.service, r.district, r.village, r.acres
       FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.business_id=? ORDER BY COALESCE(j.start_date, '9999') ASC, j.created_at ASC`,
    )
    .all(businessId) as (Row & { reference: string; service: string; district: string; village: string; acres: number })[];
  return rows.map((r) => ({ ...fromRow(r), reference: r.reference, service: r.service, district: r.district, village: r.village, acres: r.acres }));
}

/** Every job an asset is committed to that overlaps the window, ignoring one job being edited. */
export function clashesFor(equipmentId: string, start: string, end: string, exceptJobId: string | null) {
  return db
    .prepare(
      `SELECT j.id, r.reference, j.start_date, j.end_date
       FROM job_asset a JOIN job j ON j.id = a.job_id JOIN service_request r ON r.id = j.request_id
       WHERE a.equipment_id = ? AND j.status IN (${HOLDING.map(() => "?").join(",")})
         AND j.id <> COALESCE(?, '')
         AND j.start_date <= ? AND j.end_date >= ?`,
    )
    .all(equipmentId, ...HOLDING, exceptJobId, end, start) as { id: string; reference: string; start_date: string; end_date: string }[];
}

export type ScheduleInput = { startDate: string; endDate: string; operatorId: string | null; assetIds: string[] };
export type ScheduleResult = { ok: true } | { ok: false; reason: string };

/**
 * Commits machines and an operator to a window. The clash check runs inside the transaction,
 * so two schedules racing for the same plough cannot both succeed.
 */
export function scheduleJob(businessId: string, actorId: string, jobId: string, input: ScheduleInput): ScheduleResult {
  const job = getJob(businessId, jobId);
  if (!job) return { ok: false, reason: "That job is not yours." };
  if (["completed", "cancelled", "disputed"].includes(job.status)) return { ok: false, reason: "That job is finished." };
  if (input.endDate < input.startDate) return { ok: false, reason: "The end date must be on or after the start date." };
  if (input.assetIds.length === 0) return { ok: false, reason: "Choose at least one machine." };

  for (const id of input.assetIds) {
    const asset = getAsset(businessId, id);
    if (!asset) return { ok: false, reason: "One of those machines is not on your register." };
    const why = unavailableReason(asset);
    if (why) return { ok: false, reason: `${asset.name} cannot be used: ${why.toLowerCase()}.` };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of input.assetIds) {
      const clash = clashesFor(id, input.startDate, input.endDate, jobId)[0];
      if (clash) {
        db.exec("ROLLBACK");
        const asset = getAsset(businessId, id)!;
        return {
          ok: false,
          reason: `${asset.name} is already committed to ${clash.reference} from ${clash.start_date} to ${clash.end_date}.`,
        };
      }
    }
    db.prepare("DELETE FROM job_asset WHERE job_id=?").run(jobId);
    const insert = db.prepare("INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?)");
    for (const id of input.assetIds) insert.run(jobId, id);
    db.prepare(
      `UPDATE job SET start_date=?, end_date=?, operator_id=?, status=CASE WHEN status='unscheduled' THEN 'scheduled' ELSE status END, updated_at=?
       WHERE id=? AND business_id=?`,
    ).run(input.startDate, input.endDate, input.operatorId, new Date().toISOString(), jobId, businessId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  audit(actorId, "job.scheduled", jobId, `${input.startDate}..${input.endDate}`);
  return { ok: true };
}

export function startWork(businessId: string, actorId: string, jobId: string): boolean {
  const res = db
    .prepare("UPDATE job SET status='in_progress', updated_at=? WHERE id=? AND business_id=? AND status='scheduled'")
    .run(new Date().toISOString(), jobId, businessId);
  if (changed(res)) audit(actorId, "job.started", jobId);
  return changed(res) > 0;
}

/** The provider says what was done. This is a claim, not a delivery: the farmer decides that. */
export function reportWork(businessId: string, actorId: string, jobId: string, acres: number, note: string): boolean {
  const res = db
    .prepare(
      `UPDATE job SET status='work_reported', reported_acres=?, work_note=?, reported_at=?, updated_at=?
       WHERE id=? AND business_id=? AND status IN ('scheduled','in_progress')`,
    )
    .run(acres, note, new Date().toISOString(), new Date().toISOString(), jobId, businessId);
  if (changed(res)) audit(actorId, "job.work_reported", jobId, `${acres} acres`);
  return changed(res) > 0;
}

/* --------------------------------------------------------------- the farmer */

export type FarmerDecision = { ok: true } | { ok: false; reason: string };

/** Silence is not consent: only the farmer's explicit confirmation completes a job. */
export function confirmDelivery(farmerId: string, requestId: string): FarmerDecision {
  const row = db
    .prepare(
      `SELECT j.id FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.request_id=? AND r.farmer_id=? AND j.status='work_reported'`,
    )
    .get(requestId, farmerId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "There is nothing to confirm on this request yet." };
  db.prepare("UPDATE job SET status='completed', confirmed_at=?, updated_at=? WHERE id=?")
    .run(new Date().toISOString(), new Date().toISOString(), row.id);
  db.prepare("UPDATE service_request SET status='completed', updated_at=? WHERE id=?")
    .run(new Date().toISOString(), requestId);
  audit(farmerId, "job.confirmed", row.id);
  return { ok: true };
}

export function raiseConcern(farmerId: string, requestId: string, concern: string): FarmerDecision {
  const row = db
    .prepare(
      `SELECT j.id FROM job j JOIN service_request r ON r.id = j.request_id
       WHERE j.request_id=? AND r.farmer_id=? AND j.status='work_reported'`,
    )
    .get(requestId, farmerId) as { id: string } | undefined;
  if (!row) return { ok: false, reason: "There is nothing to raise a concern about yet." };
  if (concern.trim().length < 4) return { ok: false, reason: "Say what the problem is." };
  db.prepare("UPDATE job SET status='disputed', concern=?, updated_at=? WHERE id=?")
    .run(concern.trim(), new Date().toISOString(), row.id);
  audit(farmerId, "job.concern_raised", row.id, concern.trim());
  return { ok: true };
}

/** Machines on this job that cannot currently work, so the job can be flagged without losing it. */
export function atRiskAssets(businessId: string, job: Job): { name: string; why: string }[] {
  const out: { name: string; why: string }[] = [];
  for (const id of job.assetIds) {
    const asset = getAsset(businessId, id);
    if (!asset) continue;
    const why = unavailableReason(asset);
    if (why) out.push({ name: asset.name, why });
  }
  return out;
}
