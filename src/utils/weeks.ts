/**
 * ISO 8601 week utilities.
 * Weeks run Monday 00:00 UTC → Sunday 23:59:59 UTC.
 */

export interface WeekRange {
  weekISO: string;   // "2026-W12"
  weekStart: Date;   // Monday 00:00:00 UTC
  weekEnd: Date;     // Sunday 23:59:59 UTC
}

/** Returns the ISO week number (1–53) for a given date. */
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Returns the ISO week year (may differ from calendar year for week 1 / week 52-53). */
function isoWeekYear(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return date.getUTCFullYear();
}

/** Returns the Monday of the ISO week that contains `d`. */
function mondayOf(d: Date): Date {
  const day = d.getUTCDay() || 7; // convert Sunday (0) to 7
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday;
}

/** Formats a date as "YYYY-WXX". */
function toISO(d: Date): string {
  const w = isoWeekNumber(d);
  const y = isoWeekYear(d);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** Build a WeekRange from any date inside that week. */
function rangeFromDate(d: Date): WeekRange {
  const monday = mondayOf(d);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    weekISO: toISO(monday),
    weekStart: monday,
    weekEnd: sunday,
  };
}

/**
 * Parse a --week flag value into a WeekRange.
 *
 * Accepts:
 *   "this"       → current calendar week
 *   "last"       → previous calendar week (default for changelogs)
 *   "2026-W12"   → explicit ISO week
 *   "2"          → 2 weeks ago
 */
export function parseWeek(input: string = "last"): WeekRange {
  const now = new Date();

  if (input === "this") return rangeFromDate(now);

  if (input === "last") {
    const lastWeek = new Date(now);
    lastWeek.setUTCDate(now.getUTCDate() - 7);
    return rangeFromDate(lastWeek);
  }

  // "2026-W12"
  const isoMatch = /^(\d{4})-W(\d{1,2})$/.exec(input);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]!);
    const week = parseInt(isoMatch[2]!);
    // Find the Monday of that ISO week: Jan 4 is always in week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekOneMonday = mondayOf(jan4);
    const target = new Date(weekOneMonday);
    target.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);
    return rangeFromDate(target);
  }

  // "2" → N weeks ago
  const nMatch = /^(\d+)$/.exec(input);
  if (nMatch) {
    const n = parseInt(nMatch[1]!);
    const target = new Date(now);
    target.setUTCDate(now.getUTCDate() - n * 7);
    return rangeFromDate(target);
  }

  // Fallback to last week
  const lastWeek = new Date(now);
  lastWeek.setUTCDate(now.getUTCDate() - 7);
  return rangeFromDate(lastWeek);
}

/** Format a WeekRange as a human-readable label: "Mar 10 – Mar 16, 2026" */
export function formatWeekLabel(range: WeekRange): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: "numeric" };
  const start = range.weekStart.toLocaleDateString("en-US", opts);
  const end = range.weekEnd.toLocaleDateString("en-US", yearOpts);
  return `${start} – ${end}`;
}

/** "last" is the default week for changelog generation. */
export const DEFAULT_WEEK = "last";
