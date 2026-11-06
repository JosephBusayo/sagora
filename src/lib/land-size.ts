/**
 * Land is stored in acres. People may give it in hectares, and every screen shows both, so a
 * farmer who thinks in either unit reads it straight off.
 */
export const ACRES_PER_HECTARE = 2.47105;

export type LandUnit = "acres" | "hectares";

export const LAND_UNITS: readonly { id: LandUnit; label: string }[] = [
  { id: "acres", label: "Acres" },
  { id: "hectares", label: "Hectares" },
];

export const landUnit = (v: string | null | undefined): LandUnit => (v === "hectares" ? "hectares" : "acres");

/** The size as stored: hectares become acres, kept to four decimals so 2 ha reads back as 2 ha. */
export function toAcres(size: number, unit: LandUnit): number {
  return unit === "hectares" ? Math.round(size * ACRES_PER_HECTARE * 10000) / 10000 : size;
}

const plain = (n: number) => Number(n.toFixed(2)).toLocaleString("en-GB");

/** "5 acres (2.02 ha)". */
export function landSize(acres: number | null | undefined): string {
  const a = Number(acres ?? 0);
  return `${plain(a)} ${plain(a) === "1" ? "acre" : "acres"} (${plain(a / ACRES_PER_HECTARE)} ha)`;
}

/** For a form opened on a saved size: back in the unit it was most likely typed in. */
export function asTyped(acres: number): { acres: string; unit: LandUnit } {
  if (Number(acres.toFixed(2)) === acres) return { acres: String(acres), unit: "acres" };
  return { acres: String(Number((acres / ACRES_PER_HECTARE).toFixed(2))), unit: "hectares" };
}
