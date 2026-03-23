/**
 * Timezone utilities.
 *
 * Cloudflare Workers has full Intl support (V8), so we can use
 * Intl.DateTimeFormat to convert any IANA timezone name to local date components.
 *
 * Primary use: shift "last week / this week" calculations to the user's local
 * timezone so that Monday means *their* Monday, not UTC Monday.
 */

/**
 * Returns a Date whose getUTCFullYear/Month/Date/Day represent
 * the current wall-clock time in `timezone`.
 *
 * E.g. for Asia/Kolkata (UTC+5:30), if it is currently 01:00 UTC on Monday,
 * the "local now" is 06:30 Monday — same weekday, so week calculation is correct.
 */
export function localNow(timezone: string): Date {
  if (!timezone || timezone === "UTC") return new Date();

  try {
    // sv-SE gives "2026-03-22 14:30:45" — reliable parseable format
    const str = new Date().toLocaleString("sv-SE", { timeZone: timezone });
    return new Date(str.replace(" ", "T") + "Z");
  } catch {
    return new Date();
  }
}

/**
 * Format a Date for display in a given timezone.
 * Returns e.g. "Mar 22, 2026, 2:30 PM IST".
 */
export function formatInTimezone(date: Date, timezone: string): string {
  try {
    return date.toLocaleString("en-US", {
      timeZone: timezone,
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    return date.toUTCString();
  }
}
