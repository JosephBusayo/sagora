/**
 * What Sagora sells, and what each of those jobs physically needs.
 *
 * From the implement reference at the back of Karim's handover (23 November 2026), which lists
 * twenty services against the equipment each one takes. Two warnings in that document shape this
 * file more than anything else:
 *
 *   "These are service-specific alternatives, not a list every provider must own."
 *   "A catalogue match does not prove compatibility or activate a service."
 *
 * So this says what *kind* of thing a job needs — a plough of some sort, a tractor to pull it —
 * and nothing more. Whether a particular plough actually fits a particular tractor is a separate
 * question, recorded per pair by a person, in lib/pairing.ts. A type match here is a prerequisite
 * for that question, never an answer to it.
 *
 * No imports: the server reads it to decide what can be quoted, and the forms read it to decide
 * what to offer.
 */

/* ------------------------------------------------------------------- services */

export type Service = {
  id: string;
  label: string;
  /**
   * Whether this service is switched on for the current deployment. "Keep services outside the
   * approved deployment inactive" — the catalogue carries all twenty so the data model and the
   * equipment register can describe them, but only the approved ones are offered to farmers or
   * can be covered by a provider.
   */
  active: boolean;
};

/**
 * The three that are live are the three Sagora has always sold, with their original ids, so every
 * request, coverage pair and equipment row already in the database keeps its meaning. The rest are
 * listed and inactive, waiting on Karim.
 */
export const SERVICES: readonly Service[] = [
  // Live.
  { id: "ploughing", label: "Ploughing", active: true },
  { id: "harvesting", label: "Harvesting", active: true },
  { id: "planting", label: "Planting", active: true },

  // Land preparation.
  { id: "harrowing", label: "Harrowing", active: false },
  { id: "cultivation", label: "Cultivation or rotavating", active: false },
  { id: "deep_loosening", label: "Deep loosening", active: false },
  { id: "ridging", label: "Ridging", active: false },
  { id: "levelling", label: "Levelling", active: false },
  { id: "rice_puddling", label: "Rice puddling", active: false },

  // Planting and seeding.
  { id: "drilling", label: "Drilling or row planting", active: false },
  { id: "rice_direct_seeding", label: "Direct seeding of rice", active: false },
  { id: "rice_transplanting", label: "Rice transplanting", active: false },

  // Crop care.
  { id: "fertiliser_spreading", label: "Fertiliser spreading", active: false },
  { id: "spraying", label: "Spraying", active: false },
  { id: "slashing", label: "Slashing or mowing", active: false },

  // Harvest and after.
  { id: "combine_harvesting", label: "Rice combine harvesting", active: false },
  { id: "rice_cutting", label: "Rice cutting only", active: false },
  { id: "threshing", label: "Threshing or maize shelling", active: false },
  { id: "grain_cleaning", label: "Grain cleaning", active: false },
  { id: "baling", label: "Straw or hay baling", active: false },

  // Moving things about. The handover keeps these two apart on purpose.
  { id: "transport", label: "Farm transport", active: false },
  { id: "loading", label: "Loading", active: false },
  { id: "post_hole_digging", label: "Post hole digging", active: false },
];

/** Only what is switched on: what a farmer may ask for and a provider may cover. */
export const activeServices = (): readonly Service[] => SERVICES.filter((s) => s.active);

export const serviceLabelOf = (id: string) => SERVICES.find((s) => s.id === id)?.label ?? id;
export const isService = (id: string) => SERVICES.some((s) => s.id === id);
export const isActiveService = (id: string) => SERVICES.some((s) => s.id === id && s.active);

/* ---------------------------------------------------------------------- kinds */

/**
 * The kinds of thing that can be on a register. Grown from six to match the implement reference;
 * the original six keep their ids so nothing already registered changes meaning.
 */
export const KINDS = [
  // Power units.
  { id: "tractor", label: "Tractor", power: true },
  { id: "power_tiller", label: "Power tiller", power: true },
  { id: "combine", label: "Combine harvester", power: true },
  { id: "harvester", label: "Harvester", power: true },

  // Land preparation.
  { id: "plough", label: "Plough", power: false },
  { id: "harrow", label: "Harrow", power: false },
  { id: "cultivator", label: "Tine cultivator", power: false },
  { id: "rotavator", label: "Rotary tiller or rotavator", power: false },
  { id: "subsoiler", label: "Subsoiler or ripper", power: false },
  { id: "ridger", label: "Ridger", power: false },
  { id: "leveller", label: "Levelling board or blade", power: false },
  { id: "hydrotiller", label: "Floating hydrotiller", power: false },

  // Seeding and planting.
  { id: "seed_drill", label: "Seed drill", power: false },
  { id: "planter", label: "Row planter", power: false },
  { id: "rice_seeder", label: "Rice seeder", power: false },
  { id: "transplanter", label: "Rice transplanter", power: false },

  // Crop care.
  { id: "spreader", label: "Fertiliser spreader", power: false },
  { id: "sprayer", label: "Boom sprayer", power: false },
  { id: "slasher", label: "Rotary slasher or cutter", power: false },

  // Harvest and after.
  { id: "reaper", label: "Reaper", power: false },
  { id: "thresher", label: "Thresher", power: false },
  { id: "sheller", label: "Maize sheller", power: false },
  { id: "grain_cleaner", label: "Grain cleaner", power: false },
  { id: "baler", label: "Baler", power: false },

  // Moving things.
  { id: "trailer", label: "Trailer", power: false },
  { id: "loader", label: "Loader and bucket", power: false },
  { id: "auger", label: "Post hole digger or auger", power: false },

  // The original catch-all, kept so existing rows still resolve.
  { id: "machine", label: "Machine", power: true },
  { id: "other", label: "Other attachment", power: false },
] as const;

export type Kind = (typeof KINDS)[number]["id"];
export const kindLabelOf = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;
export const isPowerUnit = (id: string) => KINDS.some((k) => k.id === id && k.power);

/* ------------------------------------------------------------------ what a job takes */

export type Kit = {
  /** Power units that can do this work. */
  power: readonly string[];
  /**
   * Implements needed, as groups of alternatives: one from each group. Ploughing takes a plough;
   * cultivation takes "a tine cultivator *or* a rotary tiller", which the handover is careful to
   * say "are not automatic substitutes" — so both satisfy the requirement, and which one is right
   * is the pairing review's business, not the catalogue's.
   */
  implements: readonly (readonly string[])[];
  /**
   * A unit that does the job on its own. "Do not require a separate tractor or thresher for a
   * self-contained unit" — a combine needs no tractor reserving alongside it, and a manually
   * pulled drum seeder is "independent equipment, not necessarily a tractor attachment".
   */
  selfContained?: readonly string[];
  /** The rule in the handover's own words, shown when a provider is short of something. */
  note?: string;
};

export const SERVICE_KIT: Record<string, Kit> = {
  ploughing: { power: ["tractor"], implements: [["plough"]], note: "A harrow alone does not qualify." },
  harrowing: { power: ["tractor"], implements: [["harrow"]], note: "Record whether it is mounted or trailed." },
  cultivation: {
    power: ["tractor"], implements: [["cultivator", "rotavator"]],
    note: "A tine cultivator and a rotary tiller are not automatic substitutes for one another.",
  },
  deep_loosening: { power: ["tractor"], implements: [["subsoiler"]], note: "Sized for the depth, soil and available power." },
  ridging: { power: ["tractor"], implements: [["ridger"]], note: "Confirm spacing and crop." },
  levelling: {
    power: ["tractor"], implements: [["leveller"]],
    note: "Laser levelling needs a compatible scraper and a complete control setup.",
  },
  rice_puddling: {
    power: ["tractor", "power_tiller"], implements: [["rotavator", "harrow", "hydrotiller"]],
    selfContained: ["hydrotiller"],
    note: "Wheel, rotary and harrow requirements depend on the model and the field.",
  },
  drilling: {
    power: ["tractor"], implements: [["seed_drill", "planter"]],
    note: "Confirm metering, rows and spacing.",
  },
  rice_direct_seeding: {
    power: [], implements: [["rice_seeder"]], selfContained: ["rice_seeder"],
    note: "A manually pulled drum seeder is independent equipment, not necessarily a tractor attachment.",
  },
  rice_transplanting: {
    power: ["tractor"], implements: [["transplanter"]], selfContained: ["transplanter"],
    note: "A self-propelled transplanter is a machine in its own right.",
  },
  fertiliser_spreading: {
    power: ["tractor"], implements: [["spreader"]],
    note: "This does not establish spraying capability.",
  },
  spraying: {
    power: ["tractor"], implements: [["sprayer"]],
    note: "A complete sprayer: tank, pump and nozzles.",
  },
  slashing: {
    power: ["tractor"], implements: [["slasher"]],
    note: "This does not imply stump removal or full land clearing.",
  },
  combine_harvesting: {
    power: ["combine"], implements: [], selfContained: ["combine"],
    note: "A rice-capable combine with a suitable header and threshing setup.",
  },
  rice_cutting: {
    power: ["tractor"], implements: [["reaper"]], selfContained: ["reaper"],
    note: "Cutting alone does not include threshing.",
  },
  threshing: {
    power: [], implements: [["thresher", "sheller"]], selfContained: ["thresher", "sheller"],
    note: "Record whether it is integrated, separately powered or tractor driven; reserve any separate power unit.",
  },
  grain_cleaning: {
    power: [], implements: [["grain_cleaner"]], selfContained: ["grain_cleaner"],
    note: "Grain cleaning is separate from threshing and from milling.",
  },
  baling: {
    power: ["tractor"], implements: [["baler"]],
    note: "Cutting and raking equipment is only needed when those operations are part of the agreed service.",
  },
  transport: { power: ["tractor"], implements: [["trailer"]], note: "Transport and loading are distinct services." },
  loading: { power: ["tractor"], implements: [["loader"]], note: "Transport and loading are distinct services." },
  post_hole_digging: { power: ["tractor"], implements: [["auger"]], note: "Sized for the task." },

  /* The two generic services Sagora has always sold. They are deliberately broad, because a
     farmer asking to have their rice harvested does not know whether that means a combine or a
     reaper — the provider decides that when they quote. */
  harvesting: {
    power: ["combine", "harvester", "tractor"], implements: [["reaper", "thresher"]],
    selfContained: ["combine", "harvester"],
    note: "A combine does it alone; a tractor needs a reaper.",
  },
  planting: {
    power: ["tractor"], implements: [["seed_drill", "planter", "rice_seeder", "transplanter"]],
    selfContained: ["rice_seeder", "transplanter"],
    note: "A drill, a row planter, a rice seeder or a transplanter, depending on the crop.",
  },
};

export const kitFor = (service: string): Kit => SERVICE_KIT[service] ?? { power: ["tractor"], implements: [] };

/** Whether this machine, on its own, can do the work without anything hitched to it. */
export function isSelfContainedFor(service: string, kind: string): boolean {
  return (kitFor(service).selfContained ?? []).includes(kind);
}

/** Whether this machine can be the power unit for the work. */
export function canPower(service: string, kind: string): boolean {
  const kit = kitFor(service);
  return kit.power.includes(kind) || isSelfContainedFor(service, kind);
}

/** The implement kinds that would satisfy this service, flattened, for offering a choice. */
export const implementKindsFor = (service: string): string[] => kitFor(service).implements.flat();
