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

/** Upland or lowland is its own question, apart from slope and wetness (UC06). */
export const LAND_TYPE = [
  { id: "upland", label: "Upland" },
  { id: "lowland", label: "Lowland" },
  { id: "not_sure", label: "Not sure" },
] as const;

/** Harvesting only: whether the crop can be cut yet. */
export const CROP_READINESS = [
  { id: "ready_now", label: "Ready now" },
  { id: "ready_soon", label: "Ready in the next 2 weeks" },
  { id: "not_ready", label: "Not ready yet" },
  { id: "not_sure", label: "Not sure" },
] as const;

export const asksHarvestDetails = (service: string) => service === "harvesting";

type Harvest = { service: string; landType: string; cropVariety: string; plantedOn: string; cropReadiness: string };

const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The answers beyond the designed three, as rows any screen can list. Unasked ones are left out. */
export function extraDetails(r: Harvest): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (r.landType) rows.push({ label: "Upland or lowland", value: landLabel(LAND_TYPE, r.landType) });
  if (asksHarvestDetails(r.service) && r.cropReadiness) {
    rows.push({ label: "Variety", value: r.cropVariety || "Not sure" });
    rows.push({ label: "Planted on", value: r.plantedOn ? shortDate(r.plantedOn) : "Not sure" });
    rows.push({ label: "Crop readiness", value: landLabel(CROP_READINESS, r.cropReadiness) });
  }
  return rows;
}

/** What the farmer could not say, for the provider or a coordinator to follow up before pricing. */
export function missingDetails(r: Harvest): string[] {
  const out: string[] = [];
  if (r.landType === "not_sure") out.push("Upland or lowland");
  if (asksHarvestDetails(r.service) && r.cropReadiness) {
    if (!r.cropVariety) out.push("Variety");
    if (!r.plantedOn) out.push("Planting date");
    if (r.cropReadiness === "not_sure") out.push("Crop readiness");
  }
  return out;
}
