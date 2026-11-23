/**
 * Which specifications matter for which kind of equipment.
 *
 * Karim's handover, 23 November 2026: "check power requirement and its basis, hitch/mounting, PTO
 * speed and connection, hydraulics, working width, weight and lifting/towing limits where
 * relevant. **Not every implement needs PTO.**"
 *
 * That last sentence is the whole design. A column per specification would put a PTO field on a
 * drum seeder and a working width on a tractor, and a provider faced with fields that do not apply
 * either leaves them blank or invents values. So the specs live in one JSON object on the asset and
 * this file says which keys apply to which kind.
 *
 * `critical` is the other half of the rule: "record unknown critical details as needing review" and
 * "unknown critical details block the affected service". A missing working width is untidy; a
 * missing hitch category means nobody can say whether the plough fits the tractor, so the pairing
 * cannot be verified and the service it belongs to stays blocked.
 *
 * No imports: both the server and the registration form read this.
 */

export type SpecKind = "text" | "number" | "choice";

export type Spec = {
  id: string;
  label: string;
  kind: SpecKind;
  /** For `choice`. */
  options?: readonly string[];
  /** Shown under the field. Says what the value is for, not how to type it. */
  hint?: string;
  /** Unknown blocks the services this kind takes part in, rather than merely looking untidy. */
  critical?: boolean;
  /** Appended after the value when it is read back: "90 hp", "2.5 m". */
  unit?: string;
};

/* ------------------------------------------------------------- the specifications */

const POWER: Spec = {
  id: "power", label: "Engine power", kind: "number", unit: "hp",
  hint: "What the machine produces at the PTO or the drawbar.", critical: true,
};

const POWER_NEEDED: Spec = {
  id: "powerNeeded", label: "Power needed to pull it", kind: "number", unit: "hp",
  hint: "The minimum tractor this works behind. The handover asks for the basis as well as the figure.",
  critical: true,
};

const POWER_BASIS: Spec = {
  id: "powerBasis", label: "Where that figure comes from", kind: "choice",
  options: ["Manufacturer's manual", "Dealer or supplier", "Our own experience", "Estimated"],
  hint: "A manual and a guess are not the same evidence.",
};

const HITCH: Spec = {
  id: "hitch", label: "Hitch or mounting", kind: "choice",
  options: ["Three-point category 1", "Three-point category 2", "Three-point category 3", "Drawbar", "Trailed", "Self-propelled", "Other"],
  hint: "How it attaches. This is what decides whether a given tractor can carry it.", critical: true,
};

const PTO: Spec = {
  id: "pto", label: "PTO", kind: "choice",
  options: ["Not needed", "540 rpm", "1000 rpm", "540 and 1000 rpm"],
  hint: "Leave as Not needed for anything without a driven shaft.",
};

const HYDRAULICS: Spec = {
  id: "hydraulics", label: "Hydraulics needed", kind: "choice",
  options: ["None", "One double-acting outlet", "Two double-acting outlets", "Three or more"],
};

const WIDTH: Spec = { id: "width", label: "Working width", kind: "number", unit: "m" };
const DEPTH: Spec = { id: "depth", label: "Working depth", kind: "number", unit: "cm" };
const WEIGHT: Spec = { id: "weight", label: "Weight", kind: "number", unit: "kg" };

const LIFT: Spec = {
  id: "lift", label: "Lift capacity", kind: "number", unit: "kg",
  hint: "What the rear linkage can raise. Decides which implements this tractor can carry.", critical: true,
};

const TOW: Spec = { id: "tow", label: "Towing limit", kind: "number", unit: "kg" };
const ROWS: Spec = { id: "rows", label: "Number of rows", kind: "number" };
const SPACING: Spec = { id: "spacing", label: "Row spacing", kind: "number", unit: "cm" };
const TANK: Spec = { id: "tank", label: "Tank capacity", kind: "number", unit: "L" };
const HEADER: Spec = { id: "header", label: "Header or cutting width", kind: "number", unit: "m", critical: true };

const OWN_ENGINE: Spec = {
  id: "ownEngine", label: "Own power source", kind: "choice",
  options: ["Needs a tractor", "Own engine", "Electric motor"],
  hint: "A unit with its own engine needs no tractor reserving alongside it.", critical: true,
};

/* --------------------------------------------------------------- kind to specs */

/**
 * Keyed by the `kind` values in lib/equipment.ts. A kind missing here gets BASE, which is the
 * handful of things true of almost anything with wheels.
 */
const BASE: readonly Spec[] = [WEIGHT];

export const SPECS_BY_KIND: Record<string, readonly Spec[]> = {
  tractor: [POWER, POWER_BASIS, HITCH, PTO, HYDRAULICS, LIFT, TOW, WEIGHT],
  plough: [POWER_NEEDED, POWER_BASIS, HITCH, WIDTH, DEPTH, WEIGHT],
  harrow: [POWER_NEEDED, POWER_BASIS, HITCH, WIDTH, WEIGHT],
  harvester: [OWN_ENGINE, POWER, HEADER, WIDTH, WEIGHT],
  trailer: [HITCH, TOW, WEIGHT],
  other: [POWER_NEEDED, POWER_BASIS, HITCH, PTO, HYDRAULICS, WIDTH, WEIGHT, ROWS, SPACING, TANK, OWN_ENGINE],
};

export const specsFor = (kind: string): readonly Spec[] => SPECS_BY_KIND[kind] ?? BASE;

/* ------------------------------------------------------------------- reading */

export type SpecValues = Record<string, string>;

/** Parses the stored JSON, never throwing: a corrupt blob reads as "nothing recorded". */
export function parseSpecs(raw: string | null | undefined): SpecValues {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SpecValues = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Keeps only keys this kind actually uses, so changing a kind does not carry stale values along. */
export function cleanSpecs(kind: string, values: SpecValues): SpecValues {
  const allowed = new Set(specsFor(kind).map((s) => s.id));
  const out: SpecValues = {};
  for (const [k, v] of Object.entries(values)) if (allowed.has(k) && v.trim()) out[k] = v.trim().slice(0, 80);
  return out;
}

/** The critical specifications this kind needs that have not been recorded. */
export function missingCritical(kind: string, values: SpecValues): Spec[] {
  return specsFor(kind).filter((s) => s.critical && !values[s.id]);
}

/** For reading back: "90 hp", "Three-point category 2". Empty for anything not recorded. */
export function describeSpecs(kind: string, values: SpecValues): { label: string; value: string }[] {
  return specsFor(kind)
    .filter((s) => values[s.id])
    .map((s) => ({ label: s.label, value: s.unit ? `${values[s.id]} ${s.unit}` : values[s.id] }));
}
