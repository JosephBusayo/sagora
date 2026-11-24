import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { getAsset } from "./equipment";
import { conditionLabel, unavailableReason } from "./equipment";

/**
 * Somebody who may see one machine, and nothing else.
 *
 * Karim's handover, 23 November 2026 (A15): "Support an authorised asset-owner viewer, scoped to
 * named assets only."
 *
 * The case this is for: a donor or a lessor put up a tractor and is entitled to know how it is
 * being used. They are not entitled to the provider's customers, prices, other equipment or
 * earnings, and they have no business holding a provider login to get at any of it.
 *
 * Four decisions:
 *
 *  - **Granted per machine, by its owner.** Not a role, not a permission level. A grant names one
 *    machine and one person, and a second machine needs a second grant. "Scoped to named assets
 *    only" is the requirement and a list of names is the only honest way to meet it.
 *  - **Keyed by email, not by user id.** The people this is for — a programme officer, a lessor's
 *    clerk — do not have Sagora accounts, and making them sign up to read one number would mean
 *    nobody ever uses it.
 *  - **There is no join from here to a request, a quote or a farmer.** Not "those joins are
 *    filtered"; they are absent. `utilisationFor` below returns days and counts, and the only free
 *    text it can emit comes from the machine's own record.
 *  - **Revoked, not deleted.** Who could see what, and when, is the sort of thing somebody asks
 *    about afterwards.
 */

export type Grant = {
  id: string; equipmentId: string; email: string; label: string;
  grantedAt: string; revokedAt: string;
};

type Row = {
  id: string; equipment_id: string; business_id: string; email: string; label: string;
  granted_by: string; granted_at: string; revoked_by: string; revoked_at: string;
};

const fromRow = (r: Row): Grant => ({
  id: r.id, equipmentId: r.equipment_id, email: r.email, label: r.label,
  grantedAt: r.granted_at, revokedAt: r.revoked_at,
});

const tidyEmail = (v: string) => v.trim().toLowerCase();
const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v);

/* ------------------------------------------------------------------ granting */

export async function grantViewer(
  businessId: string, actorId: string, equipmentId: string, emailInput: string, label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const email = tidyEmail(emailInput);
  if (!looksLikeEmail(email)) return { ok: false, reason: "Enter the email address they will use." };
  if (label.trim().length > 80) return { ok: false, reason: "Use 80 characters or fewer for the name." };

  const asset = await getAsset(businessId, equipmentId);
  if (!asset) return { ok: false, reason: "That machine is not on your register." };

  const now = new Date().toISOString();
  await db.run(`INSERT INTO asset_viewer (id, equipment_id, business_id, email, label, granted_by, granted_at)
       VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (equipment_id, email) DO UPDATE SET
       label=excluded.label, granted_by=excluded.granted_by, granted_at=excluded.granted_at,
       revoked_by='', revoked_at=''`,
    randomUUID(), equipmentId, businessId, email, label.trim(), actorId, now);
  await audit(actorId, "asset.viewer_granted", equipmentId, email);
  return { ok: true };
}

export async function revokeViewer(
  businessId: string, actorId: string, equipmentId: string, emailInput: string,
): Promise<boolean> {
  const res = await db.run(`UPDATE asset_viewer SET revoked_by=?, revoked_at=?
       WHERE equipment_id=? AND business_id=? AND email=? AND revoked_at=''`,
    actorId, new Date().toISOString(), equipmentId, businessId, tidyEmail(emailInput));
  if (res.changes) await audit(actorId, "asset.viewer_revoked", equipmentId, tidyEmail(emailInput));
  return res.changes > 0;
}

/** Who can currently see one machine. The owner's view, for the Equipment screen. */
export async function viewersOf(businessId: string, equipmentId: string): Promise<Grant[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  const rows = await db.all(`SELECT * FROM asset_viewer WHERE equipment_id=? AND business_id=?
       ORDER BY revoked_at, email`, equipmentId, businessId) as Row[];
  return rows.map(fromRow);
}

/* ------------------------------------------------------------------ viewing */

/**
 * What one machine looks like to somebody who is allowed to see only that machine.
 *
 * Days rather than money, counts rather than customers. Every field here could be read out to a
 * donor over the phone without telling them a single thing about the provider's business beyond
 * the machine they paid for.
 */
export type Utilisation = {
  equipmentId: string;
  name: string;
  /** What kind of thing it is, and its serial, so a donor can match it to their own records. */
  kind: string;
  identifier: string;
  conditionLabel: string;
  /** Whether it can work today, and if not, why — in the same words the provider sees. */
  unavailable: string | null;
  /** Days of committed work in the last year, and jobs finished. No references, no places. */
  workingDays: number;
  jobsCompleted: number;
  /** Days deliberately out of action: servicing, repair, transport. */
  downtimeDays: number;
  /** Open faults, as a count. Not their text: a fault note can name a customer or a field. */
  openFaults: number;
  /** When somebody last confirmed where it is, if ever. The location itself is not shown. */
  locationConfirmedAt: string;
};

const YEAR_MS = 365 * 86400_000;
const days = (from: string | null, to: string | null) => {
  if (!from) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${(to ?? from)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400_000) + 1) : 0;
};

/** The machines this email address may see. Empty for anybody who has not been granted one. */
export async function assetsVisibleTo(emailInput: string): Promise<string[]> {
  const email = tidyEmail(emailInput);
  if (!looksLikeEmail(email)) return [];
  const rows = await db.all(`SELECT equipment_id FROM asset_viewer WHERE email=? AND revoked_at=''`,
    email) as { equipment_id: string }[];
  return rows.map((r) => r.equipment_id);
}

/**
 * Utilisation for one machine, for one authorised viewer.
 *
 * Returns null when this address has no live grant on this machine — the check and the read are
 * the same call, so there is no way to fetch the figures and forget to ask whether you may.
 */
export async function utilisationFor(emailInput: string, equipmentId: string): Promise<Utilisation | null> {
  const allowed = await assetsVisibleTo(emailInput);
  if (!allowed.includes(equipmentId)) return null;

  // Read through the owner's own scope, so a viewer sees exactly the machine the provider sees
  // rather than a second, drifting projection of it.
  const owner = await db.get("SELECT business_id FROM equipment WHERE id=?", equipmentId) as { business_id: string } | undefined;
  if (!owner) return null;
  const asset = await getAsset(owner.business_id, equipmentId);
  if (!asset) return null;

  const since = new Date(Date.now() - YEAR_MS).toISOString().slice(0, 10);
  const jobs = await db.all(`SELECT j.start_date, j.end_date, j.status FROM job_asset a
       JOIN job j ON j.id = a.job_id
       WHERE a.equipment_id=? AND j.status <> 'cancelled'
         AND COALESCE(j.end_date, j.start_date, '') >= ?`, equipmentId, since) as
    { start_date: string | null; end_date: string | null; status: string }[];

  const down = await db.all(`SELECT from_date, to_date FROM asset_downtime
       WHERE equipment_id=? AND cancelled_at='' AND to_date >= ?`, equipmentId, since) as
    { from_date: string; to_date: string }[];

  return {
    equipmentId,
    name: asset.name,
    kind: asset.kind,
    identifier: asset.identifier,
    conditionLabel: conditionLabel(asset.condition),
    unavailable: unavailableReason(asset),
    workingDays: jobs.reduce((n, j) => n + days(j.start_date, j.end_date), 0),
    jobsCompleted: jobs.filter((j) => j.status === "completed").length,
    downtimeDays: down.reduce((n, d) => n + days(d.from_date, d.to_date), 0),
    openFaults: asset.openFaults.length,
    locationConfirmedAt: asset.locationAt,
  };
}

/** Everything one viewer may see, for their own screen. */
export async function utilisationForViewer(emailInput: string): Promise<Utilisation[]> {
  const ids = await assetsVisibleTo(emailInput);
  const out: Utilisation[] = [];
  for (const id of ids) {
    const u = await utilisationFor(emailInput, id);
    if (u) out.push(u);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
