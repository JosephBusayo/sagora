/**
 * Why a machine is out of action.
 *
 * A pure module with no imports, for the same reason lib/catalogue.ts and lib/specs.ts are: the
 * server reads this to validate what was submitted and the Equipment form reads it to decide what
 * to offer, and those two must not be able to disagree. lib/downtime.ts is `server-only` and
 * re-exports from here, so there is still one list.
 */

export const DOWNTIME_KINDS = [
  { id: "service", label: "Planned servicing" },
  { id: "repair", label: "Repair" },
  { id: "transport", label: "Being moved" },
  { id: "other", label: "Something else" },
] as const;

export type DowntimeKind = (typeof DOWNTIME_KINDS)[number]["id"];

export const downtimeLabel = (id: string) => DOWNTIME_KINDS.find((k) => k.id === id)?.label ?? id;

export const isDowntimeKind = (id: string): id is DowntimeKind =>
  DOWNTIME_KINDS.some((k) => k.id === id);
