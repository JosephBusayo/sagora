/**
 * Money is stored as an integer number of minor units (cents of SLE) and never as a float.
 * A brief rule: floats lose fractions of a leone and cannot be reconciled against a ledger.
 */

export const CURRENCY = "Le";

/** "1,500.50" or "1500.5" -> 150050. Returns null for anything that is not a clean amount. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^Le/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}

/** 150050 -> "Le 1,500.50" */
export function formatAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-GB");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${CURRENCY} ${whole}.${frac}`;
}
