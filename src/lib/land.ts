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
  { id: "dry", label: "Dry" },
  { id: "flat", label: "Flat" },
  { id: "rocky", label: "Rocky" },
] as const;

export const LAND_CLEARANCE = [
  { id: "vegetation_remains", label: "Vegetation remains" },
  { id: "cleared", label: "Cleared" },
  { id: "stumps_or_stones", label: "Stumps or stones" },
] as const;

type Option = { id: string; label: string };

/** Work on a crop that is already chosen: the farmer says which crop. Ploughing comes before one. */
export const needsCrop = (service: string) => service === "harvesting" || service === "planting";

/** The crop question's error, in the words of the work. */
export const cropMissing = (service: string) =>
  service === "planting" ? "Say what crop is being planted" : "Say what crop is being harvested";

/** Requests made before these questions existed hold an empty string. */
export const landLabel = (options: readonly Option[], id: string) =>
  options.find((o) => o.id === id)?.label ?? "Not given";
