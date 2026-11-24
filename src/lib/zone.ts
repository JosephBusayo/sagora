/**
 * The one time zone Sagora shows dates and times in.
 *
 * Karim's handover, 23 November 2026: "Use one timezone constant across every date and time
 * shown." Before this there were two spellings of the same thing across twenty-odd files — the
 * UTC identifier in most of them and the Freetown identifier in six — and they rendered
 * identically, which is exactly why it was worth fixing rather than leaving.
 *
 * They rendered identically because Sierra Leone keeps GMT all year: no daylight saving, and no
 * historical offset in the range any of this deals with. So nothing on any screen moves as a
 * result of this change, and no date assertion in the rule suites had to be touched. What changes
 * is that the code now says what it means. A reader meeting the UTC identifier on a farmer's start
 * date has to work out whether it is deliberate, a stand-in for Freetown, or somebody's default —
 * and if Sagora ever serves a country that does observe daylight saving, that is the one of the two
 * spellings that would quietly start lying.
 *
 * A pure module with no imports, so client components and server code can both read it. Dates
 * **stored** in the database stay ISO-8601 in UTC; this is only about how they are displayed.
 */

/** Where the people using this live. Sierra Leone keeps GMT all year — no daylight saving. */
export const ZONE = "Africa/Freetown";

/** "16 Nov 2026" — the short form used in tables, cards and lists. */
export const onDay = (iso: string): string =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: ZONE,
  });

/** "16 November 2026" — the long form, for a single date a farmer is reading on its own. */
export const onDayLong = (iso: string): string =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: ZONE,
  });

/** "16 Nov, 14:30" — for a deadline, where the hour is the point. */
export const atTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: ZONE,
  });
