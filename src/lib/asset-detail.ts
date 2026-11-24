import "server-only";
import { db } from "./db";
import { serviceLabelOf } from "./catalogue";
import { downtimeFor, downtimeLabel, type Downtime } from "./downtime";
import { faultHistory, getAsset, type Fault } from "./equipment";

/**
 * Everything one machine's detail window shows beyond its own facts.
 *
 * Karim's handover, 23 November 2026: "Equipment detail opens to four tabs: Overview, Schedule, Job
 * history, Faults and repairs", and separately "show assignment activity for cancellations,
 * replacements and expired holds, with no prices shown".
 *
 * Two things shape this file:
 *
 *  - **Where a machine is committed is one question, asked once.** Schedule reads live holds,
 *    committed jobs and booked-out downtime together, because a provider looking at a calendar
 *    does not care which table a commitment lives in — and because three separate lists would
 *    eventually disagree.
 *  - **No prices, anywhere.** The handover says so for assignment activity and it is right for all
 *    of it: this window is reached by anyone with `view_jobs`, which is the permission a yard hand
 *    or a driver gets. They need to know where the tractor is going, not what it cost.
 */

/* ------------------------------------------------------------------ schedule */

export type Commitment = {
  kind: "hold" | "job" | "downtime";
  /** Set on a downtime row, so a screen can offer to call that span off where it is listed. */
  downtimeId?: string;
  from: string;
  to: string;
  /** What it is for, in words. A reference for work, a reason for downtime. Never a price. */
  what: string;
  /** Where the work is, when there is a where. */
  where: string;
  /** Firm from here on: a converted hold or a scheduled job, as against a quote nobody has answered. */
  committed: boolean;
};

/**
 * Where this machine is spoken for, soonest first.
 *
 * `from` defaults to today, so the tab opens on what is coming rather than on a year of history —
 * Job history is the other tab and answers the other question.
 */
export async function scheduleFor(
  businessId: string, equipmentId: string, from = new Date().toISOString().slice(0, 10),
): Promise<Commitment[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  const out: Commitment[] = [];

  // Live holds from quotes nobody has answered yet. Only this business's own: a borrowed machine's
  // other commitments are somebody else's business, and `clashesFor` redacts them for a reason.
  const held = await db.all(`SELECT h.block_from, h.block_to, h.start_date, h.end_date, h.status,
         sr.reference, sr.village, sr.district, sr.service
       FROM resource_hold h
       JOIN service_request sr ON sr.id = h.request_id
       WHERE h.resource_id=? AND h.business_id=? AND h.status IN ('held','converted')
         AND COALESCE(NULLIF(h.block_to,''), h.end_date) >= ?
         AND (h.status = 'converted' OR h.expires_at > ?)
       ORDER BY h.start_date`, equipmentId, businessId, from, new Date().toISOString()) as {
    block_from: string | null; block_to: string | null; start_date: string; end_date: string;
    status: string; reference: string; village: string; district: string; service: string;
  }[];
  for (const h of held) {
    out.push({
      kind: "hold",
      from: h.block_from || h.start_date,
      to: h.block_to || h.end_date,
      what: h.status === "converted"
        ? `${serviceLabelOf(h.service)} for ${h.reference}`
        : `${serviceLabelOf(h.service)} quoted on ${h.reference}, waiting for an answer`,
      where: [h.village, h.district].filter(Boolean).join(", "),
      committed: h.status === "converted",
    });
  }

  // Jobs, which is where private work shows up. Private work is a request owned by the business
  // itself (migration 005, `private_to`), so it goes through the same overlap checks as everything
  // else — that is precisely why the handover wanted it inside the booking flow. The join is left
  // outer anyway, so a job whose request has been removed still lists rather than vanishing.
  const jobs = await db.all(`SELECT j.start_date, j.end_date, j.block_from, j.block_to, j.status,
         COALESCE(sr.reference, '') AS reference, COALESCE(sr.village, '') AS village,
         COALESCE(sr.district, '') AS district, COALESCE(sr.service, '') AS service,
         CASE WHEN sr.private_to IS NULL THEN '' ELSE COALESCE(sr.contact_name, 'Your own work') END AS private_customer
       FROM job_asset a JOIN job j ON j.id = a.job_id
       LEFT JOIN service_request sr ON sr.id = j.request_id
       WHERE a.equipment_id=? AND j.business_id=?
         AND j.status IN ('scheduled','in_progress','work_reported')
         AND COALESCE(j.block_to, j.end_date) >= ?
       ORDER BY j.start_date`, equipmentId, businessId, from) as {
    start_date: string | null; end_date: string | null; block_from: string | null; block_to: string | null;
    status: string; reference: string; village: string; district: string; service: string; private_customer: string;
  }[];
  for (const j of jobs) {
    if (!j.start_date) continue;
    // A converted hold and its job are the same commitment. Listing both would make a provider
    // think the machine was booked twice.
    const already = out.some((c) => c.kind === "hold" && c.committed && c.from === (j.block_from || j.start_date));
    if (already) continue;
    out.push({
      kind: "job",
      from: j.block_from || j.start_date,
      to: j.block_to || j.end_date || j.start_date,
      what: j.private_customer
        ? `Your own work: ${j.private_customer}`
        : `${serviceLabelOf(j.service)} for ${j.reference}`,
      where: [j.village, j.district].filter(Boolean).join(", "),
      committed: true,
    });
  }

  for (const d of await downtimeFor(businessId, equipmentId)) {
    if (d.cancelledAt !== "" || d.toDate < from) continue;
    out.push({
      kind: "downtime", from: d.fromDate, to: d.toDate, downtimeId: d.id,
      what: d.reason ? `${downtimeLabel(d.kind)} — ${d.reason}` : downtimeLabel(d.kind),
      where: "", committed: true,
    });
  }

  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/* --------------------------------------------------------------- job history */

export type PastJob = {
  reference: string;
  what: string;
  where: string;
  from: string;
  to: string;
  status: string;
  /** What was actually worked, which is the figure a provider checks a machine against. */
  acres: number | null;
};

/** What this machine has done, most recent first. Finished and cancelled work alike. */
export async function jobHistoryFor(businessId: string, equipmentId: string, limit = 50): Promise<PastJob[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  const rows = await db.all(`SELECT j.start_date, j.end_date, j.status, j.reported_acres,
         COALESCE(sr.reference, '') AS reference, COALESCE(sr.village, '') AS village,
         COALESCE(sr.district, '') AS district, COALESCE(sr.service, '') AS service,
         COALESCE(sr.acres, 0) AS acres,
         CASE WHEN sr.private_to IS NULL THEN '' ELSE COALESCE(sr.contact_name, 'Your own work') END AS private_customer
       FROM job_asset a JOIN job j ON j.id = a.job_id
       LEFT JOIN service_request sr ON sr.id = j.request_id
       WHERE a.equipment_id=? AND j.business_id=?
         AND j.status IN ('completed','cancelled','disputed')
       ORDER BY COALESCE(j.end_date, j.start_date, j.created_at) DESC
       LIMIT ?`, equipmentId, businessId, limit) as {
    start_date: string | null; end_date: string | null; status: string; reported_acres: number | null;
    reference: string; village: string; district: string; service: string; acres: number; private_customer: string;
  }[];
  return rows.map((r) => ({
    reference: r.reference,
    what: r.private_customer ? `Your own work: ${r.private_customer}` : serviceLabelOf(r.service),
    where: [r.village, r.district].filter(Boolean).join(", "),
    from: r.start_date ?? "",
    to: r.end_date ?? r.start_date ?? "",
    status: r.status,
    acres: r.reported_acres === null ? (r.acres || null) : Number(r.reported_acres),
  }));
}

/* ----------------------------------------------------- assignment activity */

export type Assignment = {
  at: string;
  /** What happened, in plain words. Never a price. */
  text: string;
};

/**
 * What has been done with this machine's assignments: holds released, work cancelled, machines
 * swapped, bookings flagged.
 *
 * "Show assignment activity for cancellations, replacements and expired holds, with no prices
 * shown." Read from the records that caused each event rather than from a log somebody has to
 * remember to write — a released hold carries its own reason, so the activity list cannot drift
 * out of step with what actually happened.
 */
export async function assignmentActivityFor(
  businessId: string, equipmentId: string, limit = 40,
): Promise<Assignment[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  const out: Assignment[] = [];

  // Every hold this machine has had, and what became of it. release_reason is written by whoever
  // let it go — expiry, a withdrawal, losing to another provider, a reschedule.
  const holds = await db.all(`SELECT h.status, h.created_at, h.released_at, h.release_reason,
         h.start_date, h.end_date, sr.reference
       FROM resource_hold h JOIN service_request sr ON sr.id = h.request_id
       WHERE h.resource_id=? AND h.business_id=?
       ORDER BY h.created_at DESC LIMIT ?`, equipmentId, businessId, limit) as {
    status: string; created_at: string; released_at: string | null; release_reason: string | null;
    start_date: string; end_date: string; reference: string;
  }[];
  for (const h of holds) {
    out.push({ at: h.created_at, text: `Reserved for ${h.reference}, ${h.start_date} to ${h.end_date}` });
    if (h.status === "released" && h.released_at) {
      out.push({
        at: h.released_at,
        text: `Let go from ${h.reference}${h.release_reason ? `: ${h.release_reason.toLowerCase()}` : ""}`,
      });
    }
    if (h.status === "converted" && h.released_at) {
      out.push({ at: h.released_at, text: `Committed to ${h.reference} as a booking` });
    }
  }

  // Bookings something put in doubt, and how that was answered.
  const flags = await db.all(`SELECT f.raised_at, f.resolved_at, f.reason, f.resolution,
         COALESCE(sr.reference, '') AS reference
       FROM booking_flag f JOIN job j ON j.id = f.job_id
       LEFT JOIN service_request sr ON sr.id = j.request_id
       WHERE f.equipment_id=? AND j.business_id=?
       ORDER BY f.raised_at DESC LIMIT ?`, equipmentId, businessId, limit) as {
    raised_at: string; resolved_at: string; reason: string; resolution: string; reference: string;
  }[];
  for (const f of flags) {
    out.push({ at: f.raised_at, text: `${f.reference || "A booking"} flagged: ${f.reason}` });
    if (f.resolved_at) out.push({ at: f.resolved_at, text: `Dealt with: ${f.resolution}` });
  }

  // Swaps and removals, which the audit log is the only record of.
  const swaps = await db.all(`SELECT at, action, detail FROM audit_log
       WHERE entity_id=? AND action IN ('equipment.downtime', 'equipment.downtime_cancelled',
         'asset.shared', 'asset.share_revoked', 'equipment.condition')
       ORDER BY at DESC LIMIT ?`, equipmentId, limit) as
    { at: string; action: string; detail: string }[];
  const SAID: Record<string, string> = {
    "equipment.downtime": "Booked out",
    "equipment.downtime_cancelled": "Downtime called off",
    "asset.shared": "Lent to another provider",
    "asset.share_revoked": "Taken back from another provider",
    "equipment.condition": "Condition changed",
  };
  for (const a of swaps) {
    out.push({ at: a.at, text: `${SAID[a.action] ?? a.action}${a.detail && a.action === "equipment.downtime" ? `: ${a.detail}` : ""}` });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/* ------------------------------------------------------------------ all of it */

export type AssetDetail = {
  schedule: Commitment[];
  history: PastJob[];
  activity: Assignment[];
  faults: Fault[];
  downtime: Downtime[];
};

/** The three tabs beyond Overview, in one round of queries. */
export async function detailFor(businessId: string, equipmentId: string): Promise<AssetDetail> {
  const [schedule, history, activity, faults, downtime] = await Promise.all([
    scheduleFor(businessId, equipmentId),
    jobHistoryFor(businessId, equipmentId),
    assignmentActivityFor(businessId, equipmentId),
    faultHistory(businessId, equipmentId),
    downtimeFor(businessId, equipmentId),
  ]);
  return { schedule, history, activity, faults, downtime };
}
