import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { audit } from "./business";
import { getAsset, listAssets, unavailableReason, type Asset } from "./equipment";

/**
 * One machine, two providers.
 *
 * Karim's handover, 23 November 2026: "A shared asset must share its reservation constraint without
 * sharing business data."
 *
 * The reservation half was already true and cost nothing. A hold is on a resource id, so a tractor
 * two businesses can both commit collides with itself regardless of whose quote named it — the
 * handover's "one physical plough linked to two tractors is still one plough", applied to
 * letterheads instead of hitches.
 *
 * The *business data* half is the work, and it is mostly work of omission. Two things are kept
 * apart deliberately:
 *
 *  - **Reading and writing are different scopes.** `listAssets` and `getAsset` in lib/equipment.ts
 *    still answer only for the owning business, and every path that edits, retires, faults, pairs
 *    or re-specifies a machine goes through them. A borrower therefore cannot change a machine they
 *    did not register — not by policy check, but because the query cannot see it. What this file
 *    adds is `usableAssets`, a strictly read-and-reserve view used by quoting and scheduling.
 *  - **A clash tells the dates and nothing else.** When a borrower finds the machine busy they need
 *    the dates to plan around; they must not learn the reference, the farmer or the service,
 *    because none of that is theirs. That redaction lives in `clashesFor` in lib/holds.ts, keyed on
 *    the asking business. It is the one place a leak could happen and so the one place it is tested.
 *
 * What a share deliberately is not: a route to the other business's requests, quotes, prices,
 * farmers or earnings. There is no join from here to any of them.
 */

export type Share = {
  id: string; equipmentId: string; businessId: string;
  grantedBy: string; grantedAt: string; revokedAt: string; note: string;
};

type Row = {
  id: string; equipment_id: string; business_id: string; granted_by: string;
  granted_at: string; revoked_by: string; revoked_at: string; note: string;
};

const fromRow = (r: Row): Share => ({
  id: r.id, equipmentId: r.equipment_id, businessId: r.business_id,
  grantedBy: r.granted_by, grantedAt: r.granted_at, revokedAt: r.revoked_at, note: r.note,
});

/* ------------------------------------------------------------------ granting */

/**
 * Lends a machine to another business. Only the owner may, and only a machine they own.
 *
 * Re-granting a revoked share revives it rather than inserting a second row, so the history of who
 * had access stays one row per pair and `revoked_at` is the whole answer to "do they now".
 */
export async function grantShare(
  ownerBusinessId: string, actorId: string, equipmentId: string, toBusinessId: string, note: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (toBusinessId === ownerBusinessId) return { ok: false, reason: "That is already your own machine." };
  const asset = await getAsset(ownerBusinessId, equipmentId);
  if (!asset) return { ok: false, reason: "That machine is not on your register." };
  if (asset.condition === "retired") return { ok: false, reason: "A retired machine cannot be shared." };
  // Lending something you are only renting yourself is the lessor's decision, not Sagora's, so it
  // is refused here rather than guessed at.
  if (asset.ownership === "leased") {
    return { ok: false, reason: "A leased machine cannot be shared onward. Ask the lessor to grant access directly." };
  }
  const other = await db.get("SELECT id FROM provider_business WHERE id=?", toBusinessId) as { id: string } | undefined;
  if (!other) return { ok: false, reason: "That provider was not found." };

  const now = new Date().toISOString();
  await db.run(`INSERT INTO asset_share (id, equipment_id, business_id, granted_by, granted_at, note)
       VALUES (?,?,?,?,?,?)
     ON CONFLICT (equipment_id, business_id) DO UPDATE SET
       granted_by=excluded.granted_by, granted_at=excluded.granted_at, note=excluded.note,
       revoked_by='', revoked_at=''`,
    randomUUID(), equipmentId, toBusinessId, actorId, now, note);
  await audit(actorId, "asset.shared", equipmentId, toBusinessId);
  return { ok: true };
}

/**
 * Takes the machine back.
 *
 * Work the borrower has already committed is not cancelled. Revoking stops them reserving it
 * again and flags whatever they have booked, exactly as a blocking fault does — the handover's rule
 * that a commitment is "flagged for action rather than cancelled silently" is about the farmer at
 * the other end of it, and that farmer does not care why the machine became doubtful.
 */
export async function revokeShare(
  ownerBusinessId: string, actorId: string, equipmentId: string, fromBusinessId: string,
): Promise<boolean> {
  const asset = await getAsset(ownerBusinessId, equipmentId);
  if (!asset) return false;
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE asset_share SET revoked_by=?, revoked_at=?
       WHERE equipment_id=? AND business_id=? AND revoked_at=''`, actorId, now, equipmentId, fromBusinessId);
  if (!res.changes) return false;

  // Live holds the borrower placed go at once: a hold is a promise about the future, and the future
  // is what has just been withdrawn.
  await db.run(`UPDATE resource_hold SET status='released', released_at=?, release_reason='Access to the machine was withdrawn'
       WHERE resource_id=? AND business_id=? AND status='held'`, now, equipmentId, fromBusinessId);

  const { flagBookings } = await import("./flags");
  await flagBookings(equipmentId, "share", `${asset.name}: the owner has withdrawn access`, actorId, fromBusinessId);
  await audit(actorId, "asset.share_revoked", equipmentId, fromBusinessId);
  return true;
}

/** Who this machine is currently lent to. Owner's view. */
export async function sharesOf(ownerBusinessId: string, equipmentId: string): Promise<(Share & { businessName: string })[]> {
  if (!(await getAsset(ownerBusinessId, equipmentId))) return [];
  const rows = await db.all(`SELECT s.*, COALESCE(b.name,'') AS business_name FROM asset_share s
       LEFT JOIN provider_business b ON b.id = s.business_id
       WHERE s.equipment_id=? ORDER BY s.granted_at DESC`, equipmentId) as (Row & { business_name: string })[];
  return rows.map((r) => ({ ...fromRow(r), businessName: r.business_name }));
}

/** Everything this business has lent out, for the Equipment screen's own summary. */
export async function lentBy(ownerBusinessId: string): Promise<(Share & { assetName: string; businessName: string })[]> {
  const rows = await db.all(`SELECT s.*, e.name AS asset_name, COALESCE(b.name,'') AS business_name
       FROM asset_share s JOIN equipment e ON e.id = s.equipment_id
       LEFT JOIN provider_business b ON b.id = s.business_id
       WHERE e.business_id=? AND s.revoked_at='' ORDER BY e.name`, ownerBusinessId) as
    (Row & { asset_name: string; business_name: string })[];
  return rows.map((r) => ({ ...fromRow(r), assetName: r.asset_name, businessName: r.business_name }));
}

/* ------------------------------------------------------------------ using */

/** The ids of machines this business may commit but does not own. */
export async function borrowedIds(businessId: string, t: Queries = db): Promise<string[]> {
  const rows = await t.all(`SELECT equipment_id FROM asset_share WHERE business_id=? AND revoked_at=''`,
    businessId) as { equipment_id: string }[];
  return rows.map((r) => r.equipment_id);
}

/** A machine, plus whose it is. Borrowed ones carry the owner's name so a provider knows. */
export type UsableAsset = Asset & { borrowed: boolean; ownerName: string };

/**
 * Everything this business may put on a quote or a job: its own, plus what it has been lent.
 *
 * This is the read-and-reserve view. It is deliberately NOT what the Equipment screen's edit paths
 * use — see the note at the top of this file.
 */
export async function usableAssets(businessId: string): Promise<UsableAsset[]> {
  const own = (await listAssets(businessId)).map((a) => ({ ...a, borrowed: false, ownerName: "" }));
  const ids = await borrowedIds(businessId);
  if (ids.length === 0) return own;

  const marks = ids.map(() => "?").join(",");
  const rows = await db.all(`SELECT e.business_id, COALESCE(b.name,'') AS owner_name FROM equipment e
       LEFT JOIN provider_business b ON b.id = e.business_id
       WHERE e.id IN (${marks})`, ...ids) as { business_id: string; owner_name: string }[];
  const ownerName = new Map<string, string>();
  for (const [i, id] of ids.entries()) ownerName.set(id, rows[i]?.owner_name ?? "");

  const borrowed: UsableAsset[] = [];
  for (const id of ids) {
    // Fetched through the owner's own scope, so a borrowed machine is read by exactly the query
    // that reads an owned one and cannot drift from it.
    const owner = await db.get("SELECT business_id FROM equipment WHERE id=?", id) as { business_id: string } | undefined;
    if (!owner) continue;
    const a = await getAsset(owner.business_id, id);
    if (!a || a.condition === "retired") continue;
    borrowed.push({ ...a, borrowed: true, ownerName: ownerName.get(id) ?? "" });
  }
  return [...own, ...borrowed];
}

/** One machine this business may use, owned or borrowed. Null when it may not. */
export async function getUsableAsset(businessId: string, id: string): Promise<UsableAsset | null> {
  const own = await getAsset(businessId, id);
  if (own) return { ...own, borrowed: false, ownerName: "" };
  const share = await db.get(`SELECT 1 FROM asset_share WHERE equipment_id=? AND business_id=? AND revoked_at=''`,
    id, businessId) as { 1: number } | undefined;
  if (!share) return null;
  const row = await db.get(`SELECT e.business_id, COALESCE(b.name,'') AS owner_name FROM equipment e
       LEFT JOIN provider_business b ON b.id = e.business_id WHERE e.id=?`, id) as
    { business_id: string; owner_name: string } | undefined;
  if (!row) return null;
  const a = await getAsset(row.business_id, id);
  if (!a || a.condition === "retired") return null;
  return { ...a, borrowed: true, ownerName: row.owner_name };
}

/** What a job may actually be given, borrowed machines included. Mirrors `selectableAssets`. */
export async function selectableUsableAssets(businessId: string, on?: string): Promise<UsableAsset[]> {
  return (await usableAssets(businessId)).filter((a) => unavailableReason(a, on) === null);
}
