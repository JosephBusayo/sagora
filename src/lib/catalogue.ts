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
  /**
   * Where this falls in the farming year. Lower happens first.
   *
   * It exists because a request can now ask for several operations at once and they are not
   * interchangeable: you cannot harrow a field you have not ploughed. The farmer ticks what they
   * want and this decides the order, so nobody has to drag rows into sequence and nobody can get
   * it wrong. The numbers are spaced so a service can be slotted between two without renumbering.
   */
  order: number;
};

/**
 * The three that are live are the three Sagora has always sold, with their original ids, so every
 * request, coverage pair and equipment row already in the database keeps its meaning. The rest are
 * listed and inactive, waiting on Karim.
 */
export const SERVICES: readonly Service[] = [
  // Live.
  { id: "ploughing", label: "Ploughing", active: true, order: 20 },
  { id: "harvesting", label: "Harvesting", active: true, order: 80 },
  { id: "planting", label: "Planting", active: true, order: 50 },

  // Land preparation.
  { id: "harrowing", label: "Harrowing", active: false, order: 30 },
  { id: "cultivation", label: "Cultivation or rotavating", active: false, order: 35 },
  { id: "deep_loosening", label: "Deep loosening", active: false, order: 10 },
  { id: "ridging", label: "Ridging", active: false, order: 45 },
  { id: "levelling", label: "Levelling", active: false, order: 40 },
  { id: "rice_puddling", label: "Rice puddling", active: false, order: 38 },

  // Planting and seeding.
  { id: "drilling", label: "Drilling or row planting", active: false, order: 52 },
  { id: "rice_direct_seeding", label: "Direct seeding of rice", active: false, order: 54 },
  { id: "rice_transplanting", label: "Rice transplanting", active: false, order: 56 },

  // Crop care.
  { id: "fertiliser_spreading", label: "Fertiliser spreading", active: false, order: 60 },
  { id: "spraying", label: "Spraying", active: false, order: 65 },
  { id: "slashing", label: "Slashing or mowing", active: false, order: 70 },

  // Harvest and after.
  { id: "combine_harvesting", label: "Rice combine harvesting", active: false, order: 82 },
  { id: "rice_cutting", label: "Rice cutting only", active: false, order: 84 },
  { id: "threshing", label: "Threshing or maize shelling", active: false, order: 90 },
  { id: "grain_cleaning", label: "Grain cleaning", active: false, order: 95 },
  { id: "baling", label: "Straw or hay baling", active: false, order: 97 },

  // Moving things about. The handover keeps these two apart on purpose.
  { id: "transport", label: "Farm transport", active: false, order: 100 },
  { id: "loading", label: "Loading", active: false, order: 102 },
  { id: "post_hole_digging", label: "Post hole digging", active: false, order: 110 },
];

/**
 * Only what is switched on, in the order the work happens: ploughing, then planting, then
 * harvesting.
 *
 * Joseph, 25 Nov 2026, asked for exactly that order on the farmer's form and "do not arrange
 * these options alphabetically". Sorting by `order` rather than writing a second list means the
 * tick-boxes come out in the same sequence a package is actually planned in (`inFieldOrder`), so
 * a farmer reading down the form sees the order their stages will run in.
 */
export const activeServices = (): readonly Service[] =>
  SERVICES.filter((s) => s.active).slice().sort((a, b) => a.order - b.order);

export const serviceLabelOf = (id: string) => SERVICES.find((s) => s.id === id)?.label ?? id;
export const isService = (id: string) => SERVICES.some((s) => s.id === id);
export const isActiveService = (id: string) => SERVICES.some((s) => s.id === id && s.active);

/** Where one service falls in the year. Unknown ids sort last rather than first. */
export const orderOf = (id: string) => SERVICES.find((s) => s.id === id)?.order ?? 999;

/**
 * The same services, in the order the work has to happen.
 *
 * Used wherever a farmer has chosen more than one: the request stores them in this order, the
 * provider plans them in this order, and the holds are placed in this order. Sorting here rather
 * than trusting the form means a request assembled by voice intake, by a coordinator or by the
 * API all come out the same way.
 */
export const inFieldOrder = (ids: readonly string[]): string[] =>
  [...new Set(ids)].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));

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

/**
 * Whether a kind of machine can take any part at all in the services Sagora sells today.
 *
 * The register carries all thirty-one kinds because the catalogue describes twenty services, but
 * only three of those services are switched on — so a provider can register a baler, or the
 * original catch-all "Machine", and then be refused at every quote with no idea why. Naming the
 * distinction lets the forms say it at the point the choice is made, rather than letting the
 * provider find out when a farmer is waiting.
 */
export function kindServesActiveService(kind: string): boolean {
  return activeServices().some((s) =>
    canPower(s.id, kind) || implementKindsFor(s.id).includes(kind));
}

/** The live services this kind of machine can take part in, in words, for an explanation. */
export function servicesForKind(kind: string): string[] {
  return activeServices()
    .filter((s) => canPower(s.id, kind) || implementKindsFor(s.id).includes(kind))
    .map((s) => s.label);
}

/**
 * What a service needs, in a sentence: "a tractor and a plough", "a combine, or a tractor with a
 * reaper or a thresher". Written out rather than listed so a refusal reads like an answer.
 */
export function kitSentence(service: string): string {
  const kit = kitFor(service);
  const alone = (kit.selfContained ?? []).map(kindLabelOf).map((l) => l.toLowerCase());
  const power = kit.power.filter((p) => !(kit.selfContained ?? []).includes(p)).map(kindLabelOf).map((l) => l.toLowerCase());
  const groups = kit.implements.map((g) => g.map(kindLabelOf).map((l) => l.toLowerCase()).join(" or "));
  const withPower = power.length && groups.length
    ? `${article(power.join(" or "))} with ${article(groups.join(" and "))}`
    : power.length ? article(power.join(" or "))
    : groups.length ? article(groups.join(" and "))
    : "a suitable machine";
  return alone.length ? `${article(alone.join(" or "))}, or ${withPower}` : withPower;
}

/** "plough" becomes "a plough"; "auger" becomes "an auger". Only ever used on kind labels. */
export const article = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
