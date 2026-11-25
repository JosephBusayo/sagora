/** "Tue 2 Dec 2026 at 09:30", or the day alone when no time was given. Dates are plain days. */
export function visitWhen(day: string, time = ""): string {
  if (!day) return "";
  const d = new Date(`${day}T00:00:00Z`);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return time ? `${date} at ${time}` : date;
}
