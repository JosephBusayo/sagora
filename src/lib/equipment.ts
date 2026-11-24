import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";
import { cleanSpecs, missingCritical, parseSpecs, type SpecValues } from "./specs";

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
/**
 * Re-exported from the catalogue, which grew from six kinds to match the handover's implement
 * reference. The original six keep their ids, so nothing already on a register changes meaning.
 */
export { KINDS } from "./catalogue";

export const OWNERSHIP = [
  { id: "owned", label: "Owned" },
  { id: "leased", label: "Leased" },
] as const;

export { kindLabelOf as kindLabel } from "./catalogue";

/** The provider's own say on whether a machine can be booked, as the design's three chips put it. */
export const AVAILABILITY = [
  { id: "available", label: "Available" },
  { id: "unavailable", label: "Not available" },
  { id: "maintenance", label: "Under maintenance" },
] as const;
export type Availability = (typeof AVAILABILITY)[number]["id"];

/**
 * The four states Karim's handover names: "working, limited use, under repair or retired".
 *
 * This supersedes the old split between `status` (active/retired) and `availability`. Both columns
 * are still written so nothing reading them breaks, but `condition` is what decides whether a
 * machine can be committed to work.
 */
export const CONDITIONS = [
  { id: "working", label: "Working", blocks: false },
  { id: "limited", label: "Limited use", blocks: false },
  { id: "repair", label: "Under repair", blocks: true },
  { id: "retired", label: "Retired", blocks: true },
] as const;
export type Condition = (typeof CONDITIONS)[number]["id"];
export const conditionLabel = (id: string) => CONDITIONS.find((c) => c.id === id)?.label ?? id;

/**
 * Whether a serial has actually been recorded. "Missing or unreadable machine serials permit draft
 * saving and review only. Quotation remains blocked unless Karim approves an exception policy and
 * the asset satisfies it" — so an exception is a named decision by an administrator, not a flag a
 * provider can set for themselves.
 */
export const SERIAL_STATES = [
  { id: "recorded", label: "Recorded" },
  { id: "unreadable", label: "Plate unreadable" },
  { id: "none", label: "Never had one" },
] as const;
export type SerialStatus = (typeof SERIAL_STATES)[number]["id"];

export type Fault = {
  id: string; equipmentId: string; severity: "blocking" | "minor"; description: string;
  reportedAt: string; resolvedAt: string | null; resolution: string;
};

export type Asset = {
  id: string; businessId: string; kind: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string;
  retiredReason: string; createdAt: string;
  brand: string; model: string; year: string; horsepower: string; implements: string;
  /** Service ids this machine is used for. */
  services: string[]; availability: Availability;
  /** When its photo was last set, or null with no photo. Doubles as a cache-buster in the photo URL. */
  photoAt: string | null;
  /** Open faults, newest first. A blocking one makes the asset unavailable. */
  openFaults: Fault[];

  /** The provider's own reference for it, which survives a rename. */
  assetRef: string;
  serialStatus: SerialStatus;
  /** Set by an administrator where a missing serial has been allowed anyway. */
  serialExceptionBy: string;
  serialExceptionNote: string;

  condition: Condition;
  conditionNote: string;

  /** Where somebody last said it was, and when they said it. */
  location: string;
  custodian: string;
  locationAt: string;
  locationBy: string;

  /** Only meaningful when ownership is "leased". */
  lessor: string;
  leaseFrom: string;
  leaseTo: string;
  leaseNotes: string;
  /** Who inside the business may commit it, where that is not everybody. */
  authorisedBy: string;

  /** Type-specific specifications, keyed by the ids in lib/specs.ts. */
  specs: SpecValues;

  /** Kept well away from anything the earnings code reads. */
  acquiredOn: string;
  supplier: string;
  purchaseCostMinor: number | null;
  purchaseCurrency: string;
  donor: string;
  useRestrictions: string;
};

type Row = {
  id: string; business_id: string; kind: string; name: string; identifier: string;
  ownership: "owned" | "leased"; status: "active" | "retired"; notes: string;
  retired_reason: string; created_at: string;
  brand: string; model: string; year: string; horsepower: string; implements: string; services: string; availability: string;
  asset_ref?: string | null; serial_status?: string | null;
  serial_exception_by?: string | null; serial_exception_note?: string | null;
  condition?: string | null; condition_note?: string | null;
  location?: string | null; custodian?: string | null; location_at?: string | null; location_by?: string | null;
  lessor?: string | null; lease_from?: string | null; lease_to?: string | null; lease_notes?: string | null;
  authorised_by?: string | null; specs?: string | null;
  acquired_on?: string | null; supplier?: string | null; purchase_cost_minor?: number | null;
  purchase_currency?: string | null; donor?: string | null; use_restrictions?: string | null;
};
type FaultRow = {
  id: string; equipment_id: string; severity: "blocking" | "minor"; description: string;
  reported_at: string; resolved_at: string | null; resolution: string;
};

const faultFrom = (r: FaultRow): Fault => ({
  id: r.id, equipmentId: r.equipment_id, severity: r.severity, description: r.description,
  reportedAt: r.reported_at, resolvedAt: r.resolved_at, resolution: r.resolution,
});

async function withFaults(r: Row): Promise<Asset> {
  const faults = await db.all("SELECT * FROM equipment_fault WHERE equipment_id=? AND resolved_at IS NULL ORDER BY reported_at DESC", r.id) as FaultRow[];
  const photo = await db.get("SELECT updated_at FROM equipment_photo WHERE equipment_id=?", r.id) as { updated_at: string } | undefined;
  return {
    id: r.id, businessId: r.business_id, kind: r.kind, name: r.name, identifier: r.identifier,
    ownership: r.ownership, status: r.status, notes: r.notes, retiredReason: r.retired_reason,
    createdAt: r.created_at, openFaults: faults.map(faultFrom), photoAt: photo?.updated_at ?? null,
    brand: r.brand ?? "", model: r.model ?? "", year: r.year ?? "", horsepower: r.horsepower ?? "", implements: r.implements ?? "",
    services: (r.services ?? "").split(",").filter(Boolean),
    availability: (AVAILABILITY.some((a) => a.id === r.availability) ? r.availability : "available") as Availability,

    assetRef: r.asset_ref ?? "",
    serialStatus: (SERIAL_STATES.some((x) => x.id === r.serial_status) ? r.serial_status : "recorded") as SerialStatus,
    serialExceptionBy: r.serial_exception_by ?? "",
    serialExceptionNote: r.serial_exception_note ?? "",
    // Rows written before migration 026 have no condition; read the old columns the same way the
    // backfill did, so a machine is never quietly promoted to working.
    condition: (CONDITIONS.some((c) => c.id === r.condition)
      ? r.condition
      : r.status === "retired" ? "retired" : r.availability === "available" ? "working" : "repair") as Condition,
    conditionNote: r.condition_note ?? "",
    location: r.location ?? "", custodian: r.custodian ?? "",
    locationAt: r.location_at ?? "", locationBy: r.location_by ?? "",
    lessor: r.lessor ?? "", leaseFrom: r.lease_from ?? "", leaseTo: r.lease_to ?? "", leaseNotes: r.lease_notes ?? "",
    authorisedBy: r.authorised_by ?? "",
    specs: parseSpecs(r.specs),
    acquiredOn: r.acquired_on ?? "", supplier: r.supplier ?? "",
    purchaseCostMinor: r.purchase_cost_minor ?? null, purchaseCurrency: r.purchase_currency ?? "",
    donor: r.donor ?? "", useRestrictions: r.use_restrictions ?? "",
  };
}

/**
 * Why an asset cannot be put on a job right now, or null if it can.
 *
 * The single place that answers that question, which is why the handover's new rules extend it
 * rather than adding checks of their own somewhere else. The order is worst-first, so a retired
 * machine reads as retired rather than as whichever other problem it also has.
 *
 * `on` is the day being asked about. A lease that runs out in March does not stop February's work,
 * so a caller that knows the dates passes them; one that only wants today's answer can leave it.
 */
export function unavailableReason(a: Asset, on?: string): string | null {
  if (a.condition === "retired" || a.status === "retired") return "Retired";
  const blocking = a.openFaults.find((f) => f.severity === "blocking");
  if (blocking) return "Out of service";
  if (a.condition === "repair") return "Under repair";

  // A machine on loan cannot be committed outside the days it is actually available.
  if (a.ownership === "leased" && a.leaseTo) {
    const day = on ?? new Date().toISOString().slice(0, 10);
    if (day > a.leaseTo) return `Lease ended ${a.leaseTo}`;
    if (a.leaseFrom && day < a.leaseFrom) return `Leased from ${a.leaseFrom}`;
  }

  // "Missing or unreadable machine serials permit draft saving and review only." An administrator
  // can grant an exception; nobody else can.
  if (a.serialStatus !== "recorded" && !a.serialExceptionBy) {
    return a.serialStatus === "unreadable" ? "Serial unreadable, waiting on review" : "No serial recorded";
  }

  // "Record unknown critical details as needing review... unknown critical details block the
  // affected service." Without the hitch or the power it needs, no pairing can be verified.
  const missing = missingCritical(a.kind, a.specs);
  if (missing.length) return `Needs ${missing.map((m) => m.label.toLowerCase()).join(" and ")}`;

  return null;
}

/** Limited use does not stop the work, but whoever schedules it should see the restriction. */
export const limitedUseNote = (a: Asset): string | null =>
  a.condition === "limited" ? (a.conditionNote || "Limited use") : null;

/**
 * How stale the location is, in whole days, or null where nobody has ever confirmed it.
 *
 * Sagora "cannot know about an unreported breakdown, private booking or movement", so the honest
 * thing is to show when somebody last looked rather than imply the record is live.
 */
export function locationAgeDays(a: Asset): number | null {
  if (!a.locationAt) return null;
  const at = Date.parse(a.locationAt);
  return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400_000) : null;
}

export async function listAssets(businessId: string): Promise<Asset[]> {
  const rows = await db.all("SELECT * FROM equipment WHERE business_id=? ORDER BY status ASC, kind ASC, created_at ASC", businessId) as Row[];
  return Promise.all(rows.map(withFaults));
}

export async function getAsset(businessId: string, id: string): Promise<Asset | null> {
  const r = await db.get("SELECT * FROM equipment WHERE id=? AND business_id=?", id, businessId) as Row | undefined;
  return r ? withFaults(r) : null;
}

/**
 * What a job may actually be given: nothing retired, out of service, under repair, off-lease for
 * the day in question, or missing a serial or a critical specification.
 *
 * `on` is the day the work would run. Without it the answer is about today, which is right for a
 * register screen and wrong for a quote three weeks out — so the quote path passes the start date.
 */
export async function selectableAssets(businessId: string, on?: string): Promise<Asset[]> {
  const assets = await listAssets(businessId);
  return assets.filter((a) => unavailableReason(a, on) === null);
}

export type AssetInput = {
  kind: string; name: string; identifier: string; ownership: "owned" | "leased"; notes: string;
  /** The form's own key, the same on every send of that form. See migration 030. */
  submissionKey?: string | null;
  /** The Add equipment screens fill these; older callers may leave them out. */
  brand?: string; model?: string; year?: string; horsepower?: string; implements?: string; services?: string[]; availability?: Availability;

  /* Everything below arrived with Karim's handover of 23 Nov 2026. All optional, so the many
     existing callers (fixtures, scripts, the private-job flow) keep working unchanged. */
  assetRef?: string;
  serialStatus?: SerialStatus;
  condition?: Condition;
  conditionNote?: string;
  location?: string;
  custodian?: string;
  lessor?: string;
  leaseFrom?: string;
  leaseTo?: string;
  leaseNotes?: string;
  authorisedBy?: string;
  specs?: SpecValues;
  acquiredOn?: string;
  supplier?: string;
  purchaseCostMinor?: number | null;
  purchaseCurrency?: string;
  donor?: string;
  useRestrictions?: string;
};

/** The columns the handover added, in one place so add and update cannot drift apart. */
function extras(input: AssetInput, now: string) {
  const specs = cleanSpecs(input.kind, input.specs ?? {});
  // Location is only stamped when somebody actually said where it is.
  const located = (input.location ?? "").trim() || (input.custodian ?? "").trim();
  return {
    assetRef: (input.assetRef ?? "").trim(),
    serialStatus: input.serialStatus ?? "recorded",
    condition: input.condition ?? "working",
    conditionNote: (input.conditionNote ?? "").trim(),
    location: (input.location ?? "").trim(),
    custodian: (input.custodian ?? "").trim(),
    locationAt: located ? now : "",
    // Leases only mean anything on a leased machine; an owned one carries no dates.
    lessor: input.ownership === "leased" ? (input.lessor ?? "").trim() : "",
    leaseFrom: input.ownership === "leased" ? (input.leaseFrom ?? "").trim() : "",
    leaseTo: input.ownership === "leased" ? (input.leaseTo ?? "").trim() : "",
    leaseNotes: input.ownership === "leased" ? (input.leaseNotes ?? "").trim() : "",
    authorisedBy: (input.authorisedBy ?? "").trim(),
    specs: JSON.stringify(specs),
    acquiredOn: (input.acquiredOn ?? "").trim(),
    supplier: (input.supplier ?? "").trim(),
    purchaseCostMinor: input.purchaseCostMinor ?? null,
    purchaseCurrency: (input.purchaseCurrency ?? "").trim(),
    donor: (input.donor ?? "").trim(),
    useRestrictions: (input.useRestrictions ?? "").trim(),
  };
}

/** Writes one line of an asset's history. Never throws: history must not block the change itself. */
async function note(
  equipmentId: string, kind: "custody" | "location" | "condition" | "rename",
  previous: string, current: string, actorId: string, detail = "",
): Promise<void> {
  if (previous === current) return;
  try {
    await db.run(`INSERT INTO asset_custody (id, equipment_id, kind, previous, current, note, recorded_by, recorded_at)
       VALUES (?,?,?,?,?,?,?,?)`, randomUUID(), equipmentId, kind, previous, current, detail, actorId, new Date().toISOString());
  } catch (err) {
    console.error("asset_custody write failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Whether a submission key is one the server made.
 *
 * Same shape and same reasoning as `isSubmissionKey` in lib/requests.ts: anything else is ignored
 * rather than trusted, so a hand-written key cannot be used to probe for other providers' rows. Declared here
 * rather than imported, because requests.ts imports this file and a cycle is not worth one regex.
 */
const isSubmissionKey = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/**
 * Adds one machine. Two machines with the same name are two machines: nothing is merged,
 * because they are different physical objects with different histories.
 *
 * Except on a retry. "A retry must not create a duplicate" (A16): when the form sends a submission
 * key, the unique index on it means a second attempt finds the first machine instead of writing a
 * second. Two taps on a bad connection made two tractors before migration 030.
 */
export async function addAsset(businessId: string, actorId: string, input: AssetInput): Promise<Asset> {
  const now = new Date().toISOString();
  const key = input.submissionKey && isSubmissionKey(input.submissionKey) ? input.submissionKey : null;
  if (key) {
    // The same form sent again: the machine it already made. Scoped to the business, so a key
    // guessed from somewhere else cannot read another provider's register.
    const before = await db.get("SELECT id FROM equipment WHERE submission_key=? AND business_id=?",
      key, businessId) as { id: string } | undefined;
    if (before) return (await getAsset(businessId, before.id))!;
  }

  const id = randomUUID();
  const x = extras(input, now);
  const inserted = await db.run(`INSERT INTO equipment (id, business_id, kind, name, identifier, ownership, notes, brand, model, year, horsepower,
       implements, services, availability, created_at, updated_at,
       asset_ref, serial_status, condition, condition_note, location, custodian, location_at, location_by,
       lessor, lease_from, lease_to, lease_notes, authorised_by, specs,
       acquired_on, supplier, purchase_cost_minor, purchase_currency, donor, use_restrictions, submission_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
     id, businessId, input.kind, input.name, input.identifier, input.ownership, input.notes,
     input.brand ?? "", input.model ?? "", input.year ?? "", input.horsepower ?? "", input.implements ?? "",
     (input.services ?? []).join(","), input.availability ?? "available", now, now,
     x.assetRef, x.serialStatus, x.condition, x.conditionNote, x.location, x.custodian, x.locationAt, x.locationAt ? actorId : "",
     x.lessor, x.leaseFrom, x.leaseTo, x.leaseNotes, x.authorisedBy, x.specs,
     x.acquiredOn, x.supplier, x.purchaseCostMinor, x.purchaseCurrency, x.donor, x.useRestrictions, key);
  if (!inserted.changes) {
    // Both attempts arrived together and the other one won the unique index. Nothing of this one
    // was written, so there is nothing to undo.
    const other = key
      ? await db.get("SELECT id FROM equipment WHERE submission_key=? AND business_id=?", key, businessId) as { id: string } | undefined
      : undefined;
    if (other) return (await getAsset(businessId, other.id))!;
  }
  await audit(actorId, "equipment.added", id, `${input.kind} ${input.name}`);
  // Two providers claiming one serial is a thing for staff to untangle, not a reason to refuse.
  if (x.serialStatus === "recorded" && input.identifier.trim()) await raiseSerialConflict(id, businessId, input.identifier);
  return (await getAsset(businessId, id))!;
}

export async function updateAsset(businessId: string, actorId: string, id: string, input: AssetInput): Promise<boolean> {
  const now = new Date().toISOString();
  const before = await getAsset(businessId, id);
  if (!before) return false;
  const x = extras(input, now);
  // A rename or a move is history, not an overwrite: "renaming or transferring custody must not
  // create a new machine", which only means anything if the old name is still readable afterwards.
  const keepLocationAt = x.locationAt && (before.location !== x.location || before.custodian !== x.custodian)
    ? now
    : before.locationAt;

  const res = await db.run(`UPDATE equipment SET kind=?, name=?, identifier=?, ownership=?, notes=?, brand=?, model=?, year=?,
       horsepower=?, implements=?, services=?, updated_at=?,
       asset_ref=?, serial_status=?, condition=?, condition_note=?, location=?, custodian=?, location_at=?, location_by=?,
       lessor=?, lease_from=?, lease_to=?, lease_notes=?, authorised_by=?, specs=?,
       acquired_on=?, supplier=?, purchase_cost_minor=?, purchase_currency=?, donor=?, use_restrictions=?
       WHERE id=? AND business_id=? AND status='active'`,
       input.kind, input.name, input.identifier, input.ownership, input.notes,
       input.brand ?? "", input.model ?? "", input.year ?? "", input.horsepower ?? "", input.implements ?? "",
       (input.services ?? []).join(","), now,
       x.assetRef, x.serialStatus, x.condition, x.conditionNote, x.location, x.custodian, keepLocationAt,
       keepLocationAt === now ? actorId : before.locationBy,
       x.lessor, x.leaseFrom, x.leaseTo, x.leaseNotes, x.authorisedBy, x.specs,
       x.acquiredOn, x.supplier, x.purchaseCostMinor, x.purchaseCurrency, x.donor, x.useRestrictions,
       id, businessId);
  if (!res.changes) return false;

  await note(id, "rename", before.name, input.name, actorId);
  await note(id, "location", before.location, x.location, actorId, x.custodian);
  await note(id, "custody", before.custodian, x.custodian, actorId);
  await note(id, "condition", before.condition, x.condition, actorId, x.conditionNote);
  await audit(actorId, "equipment.updated", id);
  if (x.serialStatus === "recorded" && input.identifier.trim() && input.identifier !== before.identifier) {
    await raiseSerialConflict(id, businessId, input.identifier);
  }
  return true;
}

/** One asset's recorded history, newest first: renames, moves, custody and condition changes. */
export async function historyFor(businessId: string, id: string): Promise<
  { kind: string; previous: string; current: string; note: string; at: string }[]
> {
  const owned = await db.get("SELECT id FROM equipment WHERE id=? AND business_id=?", id, businessId);
  if (!owned) return [];
  const rows = await db.all(`SELECT kind, previous, current, note, recorded_at FROM asset_custody
       WHERE equipment_id=? ORDER BY recorded_at DESC LIMIT 100`, id) as
    { kind: string; previous: string; current: string; note: string; recorded_at: string }[];
  return rows.map((r) => ({ kind: r.kind, previous: r.previous, current: r.current, note: r.note, at: r.recorded_at }));
}

/**
 * Records that this serial is already on somebody else's register.
 *
 * "Resolve duplicate physical-asset claims through review, using serials and supporting records."
 * Raised, never enforced: the newcomer may be the rightful owner of a machine somebody else never
 * retired, and locking both out would punish whoever registered honestly.
 */
async function raiseSerialConflict(equipmentId: string, businessId: string, serial: string): Promise<void> {
  const clash = await db.get(`SELECT id FROM equipment
       WHERE identifier=? AND id<>? AND business_id<>? AND status='active' AND serial_status='recorded' LIMIT 1`,
    serial.trim(), equipmentId, businessId) as { id: string } | undefined;
  if (!clash) return;
  // Ordered so the same pair cannot be filed twice from either side.
  const [a, b] = [equipmentId, clash.id].sort();
  try {
    await db.run(`INSERT INTO asset_conflict (id, serial, equipment_a, equipment_b, created_at)
       VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`, randomUUID(), serial.trim(), a, b, new Date().toISOString());
  } catch (err) {
    console.error("asset_conflict write failed:", err instanceof Error ? err.message : err);
  }
}

export type SerialConflict = {
  id: string; serial: string; createdAt: string;
  sides: { equipmentId: string; name: string; business: string; businessId: string }[];
};

/** Open duplicate-serial claims, for staff review. */
export async function openSerialConflicts(): Promise<SerialConflict[]> {
  const rows = await db.all(`SELECT id, serial, equipment_a, equipment_b, created_at FROM asset_conflict
       WHERE status='open' ORDER BY created_at ASC`) as
    { id: string; serial: string; equipment_a: string; equipment_b: string; created_at: string }[];
  const out: SerialConflict[] = [];
  for (const r of rows) {
    const sides: SerialConflict["sides"] = [];
    for (const eid of [r.equipment_a, r.equipment_b]) {
      const e = await db.get(`SELECT e.name, e.business_id, b.name AS business FROM equipment e
           JOIN provider_business b ON b.id = e.business_id WHERE e.id=?`, eid) as
        { name: string; business_id: string; business: string } | undefined;
      if (e) sides.push({ equipmentId: eid, name: e.name, business: e.business, businessId: e.business_id });
    }
    out.push({ id: r.id, serial: r.serial, createdAt: r.created_at, sides });
  }
  return out;
}

/** Staff close a claim with what they decided and why. */
export async function resolveSerialConflict(staffId: string, id: string, resolution: string): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE asset_conflict SET status='resolved', resolution=?, resolved_by=?, resolved_at=?
       WHERE id=? AND status='open'`, resolution, staffId, now, id);
  if (res.changes) await audit(staffId, "asset.conflict_resolved", id, resolution);
  return res.changes > 0;
}

/**
 * An administrator allows a machine with no readable serial to be quoted anyway.
 *
 * The handover makes this a named decision rather than a setting: "quotation remains blocked unless
 * Karim approves an exception policy and the asset satisfies it", so who allowed it and why are
 * both recorded against the asset.
 */
export async function grantSerialException(staffId: string, equipmentId: string, note: string): Promise<boolean> {
  const res = await db.run(`UPDATE equipment SET serial_exception_by=?, serial_exception_note=?, updated_at=?
       WHERE id=? AND serial_status<>'recorded'`, staffId, note, new Date().toISOString(), equipmentId);
  if (res.changes) await audit(staffId, "asset.serial_exception", equipmentId, note);
  return res.changes > 0;
}

/** Available, not available or under maintenance: the provider's call, separate from faults. */
export async function setAvailability(businessId: string, actorId: string, id: string, availability: Availability): Promise<boolean> {
  // Kept in step with the condition it implies, so the two cannot disagree while both columns exist.
  const condition: Condition = availability === "available" ? "working" : "repair";
  const before = await getAsset(businessId, id);
  const res = await db.run(`UPDATE equipment SET availability=?, condition=?, updated_at=?
       WHERE id=? AND business_id=? AND status='active'`, availability, condition, new Date().toISOString(), id, businessId);
  if (res.changes) {
    if (before) await note(id, "condition", before.condition, condition, actorId);
    await audit(actorId, "equipment.availability", id, availability);
  }
  return res.changes > 0;
}

/**
 * Sets the condition directly, which is what the four-state model is for.
 *
 * "Never treat a manually selected Available status as permission to bypass these checks" — so
 * saying a machine is working does not clear a blocking fault, a lapsed lease or a missing serial.
 * Those are separate facts and unavailableReason() still reads all of them.
 */
export async function setCondition(
  businessId: string, actorId: string, id: string, condition: Condition, conditionNote: string,
): Promise<boolean> {
  const before = await getAsset(businessId, id);
  if (!before) return false;
  const res = await db.run(`UPDATE equipment SET condition=?, condition_note=?, availability=?, updated_at=?
       WHERE id=? AND business_id=? AND status='active'`,
    condition, conditionNote, condition === "working" || condition === "limited" ? "available" : "maintenance",
    new Date().toISOString(), id, businessId);
  if (res.changes) {
    await note(id, "condition", before.condition, condition, actorId, conditionNote);
    await audit(actorId, "equipment.condition", id, condition);
    // Moving a machine into repair is the same news to a waiting farmer as a blocking fault, so it
    // flags the same bookings. Moving it back out does not clear them: somebody still has to say
    // what happened to the job, which is what resolving the flag is for.
    if (condition === "repair" && before.condition !== "repair") {
      const { flagBookings } = await import("./flags");
      await flagBookings(id, "condition", `${before.name} is under repair${conditionNote ? `: ${conditionNote}` : ""}`, actorId);
    }
  }
  return res.changes > 0;
}

/** Somebody has looked and says where it is. The timestamp is the point of the record. */
export async function confirmLocation(
  businessId: string, actorId: string, id: string, location: string, custodian: string,
): Promise<boolean> {
  const before = await getAsset(businessId, id);
  if (!before) return false;
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE equipment SET location=?, custodian=?, location_at=?, location_by=?, updated_at=?
       WHERE id=? AND business_id=? AND status='active'`, location, custodian, now, actorId, now, id, businessId);
  if (res.changes) {
    await note(id, "location", before.location, location, actorId, custodian);
    await note(id, "custody", before.custodian, custodian, actorId);
    await audit(actorId, "equipment.location", id, location);
  }
  return res.changes > 0;
}

/** Retiring keeps the record and its history; it only stops the asset being chosen again. */
export async function retireAsset(businessId: string, actorId: string, id: string, reason: string): Promise<boolean> {
  const res = await db.run("UPDATE equipment SET status='retired', retired_reason=?, updated_at=? WHERE id=? AND business_id=? AND status='active'", reason, new Date().toISOString(), id, businessId);
  if (res.changes) await audit(actorId, "equipment.retired", id, reason);
  return res.changes > 0;
}

export async function restoreAsset(businessId: string, actorId: string, id: string): Promise<boolean> {
  const res = await db.run("UPDATE equipment SET status='active', retired_reason='', updated_at=? WHERE id=? AND business_id=? AND status='retired'", new Date().toISOString(), id, businessId);
  if (res.changes) await audit(actorId, "equipment.restored", id);
  return res.changes > 0;
}

/* ------------------------------------------------------------------ photos */

/** The largest photo accepted, as base64 text. The browser sends about a tenth of this. */
const PHOTO_MAX_CHARS = 1_400_000;

/**
 * Checks a photo sent as a data URL and splits it into type and data. The first bytes must really
 * be a JPEG, PNG or WebP, whatever the URL claims.
 */
export function parsePhoto(dataUrl: string): { mime: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!m || m[2].length > PHOTO_MAX_CHARS) return null;
  const head = Buffer.from(m[2].slice(0, 16), "base64");
  const ok = m[1] === "image/jpeg" ? head[0] === 0xff && head[1] === 0xd8
    : m[1] === "image/png" ? head.subarray(1, 4).toString("latin1") === "PNG"
    : head.subarray(0, 4).toString("latin1") === "RIFF";
  return ok ? { mime: m[1], data: m[2] } : null;
}

export async function setPhoto(businessId: string, actorId: string, equipmentId: string, photo: { mime: string; data: string }): Promise<boolean> {
  if (!(await getAsset(businessId, equipmentId))) return false; // never touch another provider's equipment
  await db.run(`INSERT INTO equipment_photo (equipment_id, mime, data, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(equipment_id) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at`,
    equipmentId, photo.mime, photo.data, new Date().toISOString());
  await audit(actorId, "equipment.photo", equipmentId);
  return true;
}

/** The photo itself, only for the business that owns the equipment. */
export async function getPhoto(businessId: string, equipmentId: string): Promise<{ mime: string; data: string } | null> {
  const r = await db.get(`SELECT p.mime, p.data FROM equipment_photo p JOIN equipment e ON e.id = p.equipment_id
       WHERE p.equipment_id=? AND e.business_id=?`, equipmentId, businessId) as { mime: string; data: string } | undefined;
  return r ?? null;
}

/* -------------------------------------------------------- photo gallery */

/**
 * WAITING-ON (7 Nov): "several equipment photos" — the design says photos, plural, and the
 * table above (equipment_photo, migration 009) holds exactly one. That table keeps doing exactly
 * what it did — the cover photo on cards and lists — and this is a second, additive gallery of
 * further photos, so nothing that already calls setPhoto/getPhoto changes behaviour.
 */
export const MAX_GALLERY_PHOTOS = 5;

export type EquipmentPhoto = { id: string; mime: string };

export async function listPhotos(businessId: string, equipmentId: string): Promise<EquipmentPhoto[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  return await db.all(
    `SELECT id, mime FROM equipment_photos WHERE equipment_id=? ORDER BY position ASC`, equipmentId,
  ) as EquipmentPhoto[];
}

/** Adds one photo to the gallery, up to the cap. Returns null past the cap or on someone else's equipment. */
export async function addGalleryPhoto(
  businessId: string, actorId: string, equipmentId: string, photo: { mime: string; data: string },
): Promise<string | null> {
  if (!(await getAsset(businessId, equipmentId))) return null;
  const row = (await db.get(`SELECT COUNT(*) AS n FROM equipment_photos WHERE equipment_id=?`, equipmentId)) as { n: number };
  if (Number(row.n) >= MAX_GALLERY_PHOTOS) return null;

  const id = randomUUID();
  await db.run(`INSERT INTO equipment_photos (id, equipment_id, mime, data, position, created_at) VALUES (?,?,?,?,?,?)`,
    id, equipmentId, photo.mime, photo.data, Number(row.n), new Date().toISOString());
  await audit(actorId, "equipment.gallery_photo_added", equipmentId);
  return id;
}

export async function removeGalleryPhoto(businessId: string, actorId: string, equipmentId: string, photoId: string): Promise<boolean> {
  if (!(await getAsset(businessId, equipmentId))) return false;
  const res = await db.run(`DELETE FROM equipment_photos WHERE id=? AND equipment_id=?`, photoId, equipmentId);
  if (res.changes) await audit(actorId, "equipment.gallery_photo_removed", equipmentId);
  return res.changes > 0;
}

/** One gallery photo's bytes, only for the business that owns the equipment it belongs to. */
export async function getGalleryPhoto(businessId: string, photoId: string): Promise<{ mime: string; data: string } | null> {
  const r = await db.get(`SELECT p.mime, p.data FROM equipment_photos p JOIN equipment e ON e.id = p.equipment_id
       WHERE p.id=? AND e.business_id=?`, photoId, businessId) as { mime: string; data: string } | undefined;
  return r ?? null;
}

/* ------------------------------------------------------------------ faults */

export async function reportFault(businessId: string, actorId: string, equipmentId: string, severity: "blocking" | "minor", description: string): Promise<boolean> {
  const asset = await getAsset(businessId, equipmentId);
  if (!asset) return false; // never touch another provider's machine
  await db.run("INSERT INTO equipment_fault (id, equipment_id, severity, description, reported_by, reported_at) VALUES (?,?,?,?,?,?)", randomUUID(), equipmentId, severity, description, actorId, new Date().toISOString());
  await audit(actorId, "equipment.fault_reported", equipmentId, severity);

  // "A new blocking fault must flag existing bookings for action rather than cancelling them
  // silently." Only blocking ones: a minor fault leaves the machine working, and flagging every
  // booking over a cracked mirror would train providers to dismiss the queue without reading it.
  if (severity === "blocking") {
    const { flagBookings } = await import("./flags");
    await flagBookings(equipmentId, "fault", `${asset.name}: ${description}`.trim(), actorId);
  }
  return true;
}

export async function resolveFault(businessId: string, actorId: string, faultId: string, resolution: string): Promise<boolean> {
  const row = await db.get(`SELECT f.id FROM equipment_fault f JOIN equipment e ON e.id = f.equipment_id
       WHERE f.id=? AND e.business_id=? AND f.resolved_at IS NULL`, faultId, businessId) as { id: string } | undefined;
  if (!row) return false;
  await db.run("UPDATE equipment_fault SET resolved_at=?, resolved_by=?, resolution=? WHERE id=?", new Date().toISOString(), actorId, resolution, faultId);
  await audit(actorId, "equipment.fault_resolved", faultId, resolution);
  return true;
}

/** Everything ever recorded against one machine, newest first. Nothing is removed. */
export async function faultHistory(businessId: string, equipmentId: string): Promise<Fault[]> {
  if (!(await getAsset(businessId, equipmentId))) return [];
  const rows = await db.all("SELECT * FROM equipment_fault WHERE equipment_id=? ORDER BY reported_at DESC", equipmentId) as FaultRow[];
  return rows.map(faultFrom);
}
