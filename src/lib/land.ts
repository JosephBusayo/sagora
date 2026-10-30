/**
 * The three land questions on the booking flow, in the designer's words (frame 465:11158).
 *
 * Plain data with no server imports: the form needs the options, and the provider's screens
 * need the labels. Ids are what the database stores, so a change of wording never touches a
 * saved request.
 */

export const LAND_ACCESS = [
  { id: "easy", label: "Easy access" },
  { id: "moderate", label: "Moderate access" },
  { id: "difficult", label: "Difficult access" },
] as const;

export const LAND_CONDITION = [
  { id: "sloped", label: "Sloped" },
  { id: "wet_swampy", label: "Wet/swampy" },
  { id: "flat", label: "Flat" },
  { id: "rocky", label: "Rocky" },
] as const;

export const LAND_CLEARANCE = [
  { id: "vegetation_remains", label: "Vegetation remains" },
  { id: "cleared", label: "Cleared" },
  { id: "stumps_or_stones", label: "Stomps or stones" },
] as const;

type Option = { id: string; label: string };

/** Requests made before these questions existed hold an empty string. */
export const landLabel = (options: readonly Option[], id: string) =>
  options.find((o) => o.id === id)?.label ?? "Not given";
