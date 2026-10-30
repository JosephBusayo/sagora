/**
 * The date line and greeting at the top of the home screens, as the design shows them:
 * "Monday, 19 October 2026" above "Good morning, Mike".
 *
 * Both are worked out in Sierra Leone's time zone, not the server's. A page rendered on a
 * machine in another country must still say "Good morning" when it is morning in Makeni, and
 * must not show yesterday's date to someone reading it today.
 */

/** Where the people using this live. Sierra Leone keeps GMT all year — no daylight saving. */
export const ZONE = "Africa/Freetown";

/** "Monday, 19 October 2026" */
export function todayLong(now: Date = new Date()): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: ZONE,
  });
}

/** "Good morning" before noon, "Good afternoon" until 17:00, "Good evening" after. */
export function greeting(now: Date = new Date()): string {
  // Read the hour in Freetown rather than wherever this happens to be running.
  const hour = Number(
    now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: ZONE }),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
