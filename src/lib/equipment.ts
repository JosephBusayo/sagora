import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
import { audit } from "./business";

/**
 * The equipment register: every physical asset a provider owns or leases.
 *
 * Three brief rules shape this file:
 *  - "two identical tractors stay distinct" — assets are never merged by name; each row is one
 *    machine with its own identity and its own history.
 *  - "retired assets stay readable but unselectable" — nothing is ever deleted, because jobs and
 *    agreements refer back to it. Retiring only removes it from the lists you pick from.
 *  - "a blocking fault flags affected jobs without erasing commitments" — a fault makes an asset
 *    unavailable while it is open, and the fault stays on the record once resolved.
 */

/** Kinds come from the services on offer: something that pulls, and something it pulls. */
export const KINDS = [
  { id: "tractor", label: "Tractor" },
  { id: "plough", label: "Plough" },
  { id: "harrow", label: "Harrow" },
  { id: "harvester", label: "Harvester" },
  { id: "trailer", label: "Trailer" },
  { id: "other", label: "Other attachment" },
] as const;

export const OWNERSHIP = [
  { id: "owned", label: "Owned" },
  { id: "leased", label: "Leased" },
] as const;

export const kindLabel = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;

export type Fault = {
  id: string; equipmentId: string; severity: "blocking" | "minor"; description: string;
  reportedAt: string; resolvedAt: string | null; resolution: string;
};

export type Asset = {
  id: string; businessId: string; kind: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string;
  retiredReason: string; createdAt: string;
  /** Open faults, newest first. A blocking one makes the asset unavailable. */
  openFaults: Fault[];
};

type Row = {
  id: string; business_id: string; kind: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string;
  retired_reason: string; created_at: string;
};
type FaultRow = {
  id: string; equipment_id: string; severity: "blocking" | "minor"; description: string;
  reported_at: string; resolved_at: string | null; resolution: string;
};

const faultFrom = (r: FaultRow): Fault => ({
  id: r.id, equipmentId: r.equipment_id, severity: r.severity, description: r.description,
  reportedAt: r.reported_at, resolvedAt: r.resolved_at, resolution: r.resolution,
});

function withFaults(r: Row): Asset {
  const faults = db
    .prepare("SELECT * FROM equipment_fault WHERE equipment_id=? AND resolved_at IS NULL ORDER BY reported_at DESC")
    .all(r.id) as FaultRow[];
  return {
    id: r.id, businessId: r.business_id, kind: r.kind, name: r.name, identifier: r.identifier,
    ownership: r.ownership, status: r.status, notes: r.notes, retiredReason: r.retired_reason,
    createdAt: r.created_at, openFaults: faults.map(faultFrom),
  };
}

/** Why an asset cannot be put on a job right now, or null if it can. */
export function unavailableReason(a: Asset): string | null {
  if (a.status === "retired") return "Retired";
  const blocking = a.openFaults.find((f) => f.severity === "blocking");
  if (blocking) return "Out of service";
  return null;
}

export function listAssets(businessId: string): Asset[] {
  const rows = db
    .prepare("SELECT * FROM equipment WHERE business_id=? ORDER BY status ASC, kind ASC, created_at ASC")
    .all(businessId) as Row[];
  return rows.map(withFaults);
}

export function getAsset(businessId: string, id: string): Asset | null {
  const r = db.prepare("SELECT * FROM equipment WHERE id=? AND business_id=?").get(id, businessId) as Row | undefined;
  return r ? withFaults(r) : null;
}

/** What a job may actually be given: active, with no blocking fault open. */
export function selectableAssets(businessId: string): Asset[] {
  return listAssets(businessId).filter((a) => unavailableReason(a) === null);
}

export type AssetInput = { kind: string; name: string; identifier: string; ownership: "owned" | "leased"; notes: string };

/**
 * Adds one machine. Two machines with the same name are two machines: nothing is merged,
 * because they are different physical objects with different histories.
 */
export function addAsset(businessId: string, actorId: string, input: AssetInput): Asset {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO equipment (id, business_id, kind, name, identifier, ownership, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, businessId, input.kind, input.name, input.identifier, input.ownership, input.notes, now, now);
  audit(actorId, "equipment.added", id, `${input.kind} ${input.name}`);
  return getAsset(businessId, id)!;
}

export function updateAsset(businessId: string, actorId: string, id: string, input: AssetInput): boolean {
  const res = db
    .prepare(
      `UPDATE equipment SET kind=?, name=?, identifier=?, ownership=?, notes=?, updated_at=?
       WHERE id=? AND business_id=? AND status='active'`,
    )
    .run(input.kind, input.name, input.identifier, input.ownership, input.notes, new Date().toISOString(), id, businessId);
  if (changed(res)) audit(actorId, "equipment.updated", id);
  return changed(res) > 0;
}

/** Retiring keeps the record and its history; it only stops the asset being chosen again. */
export function retireAsset(businessId: string, actorId: string, id: string, reason: string): boolean {
  const res = db
    .prepare("UPDATE equipment SET status='retired', retired_reason=?, updated_at=? WHERE id=? AND business_id=? AND status='active'")
    .run(reason, new Date().toISOString(), id, businessId);
  if (changed(res)) audit(actorId, "equipment.retired", id, reason);
  return changed(res) > 0;
}

export function restoreAsset(businessId: string, actorId: string, id: string): boolean {
  const res = db
    .prepare("UPDATE equipment SET status='active', retired_reason='', updated_at=? WHERE id=? AND business_id=? AND status='retired'")
    .run(new Date().toISOString(), id, businessId);
  if (changed(res)) audit(actorId, "equipment.restored", id);
  return changed(res) > 0;
}

/* ------------------------------------------------------------------ faults */

export function reportFault(businessId: string, actorId: string, equipmentId: string, severity: "blocking" | "minor", description: string): boolean {
  if (!getAsset(businessId, equipmentId)) return false; // never touch another provider's machine
  db.prepare(
    "INSERT INTO equipment_fault (id, equipment_id, severity, description, reported_by, reported_at) VALUES (?,?,?,?,?,?)",
  ).run(randomUUID(), equipmentId, severity, description, actorId, new Date().toISOString());
  audit(actorId, "equipment.fault_reported", equipmentId, severity);
  return true;
}

export function resolveFault(businessId: string, actorId: string, faultId: string, resolution: string): boolean {
  const row = db
    .prepare(
      `SELECT f.id FROM equipment_fault f JOIN equipment e ON e.id = f.equipment_id
       WHERE f.id=? AND e.business_id=? AND f.resolved_at IS NULL`,
    )
    .get(faultId, businessId) as { id: string } | undefined;
  if (!row) return false;
  db.prepare("UPDATE equipment_fault SET resolved_at=?, resolved_by=?, resolution=? WHERE id=?")
    .run(new Date().toISOString(), actorId, resolution, faultId);
  audit(actorId, "equipment.fault_resolved", faultId, resolution);
  return true;
}

/** Everything ever recorded against one machine, newest first. Nothing is removed. */
export function faultHistory(businessId: string, equipmentId: string): Fault[] {
  if (!getAsset(businessId, equipmentId)) return [];
  const rows = db
    .prepare("SELECT * FROM equipment_fault WHERE equipment_id=? ORDER BY reported_at DESC")
    .all(equipmentId) as FaultRow[];
  return rows.map(faultFrom);
}
