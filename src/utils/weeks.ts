/**
 * ISO 8601 week utilities + flexible date range parsing.
 * Weeks run Monday 00:00 → Sunday 23:59:59 in the *user's timezone* (defaults to UTC).
 */

import type { DateRange } from "../types";
import { localNow } from "./timezone";

export interface WeekRange {
  weekISO:   string;
  weekStart: Date;
  weekEnd:   Date;
}

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isoWeekYear(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return date.getUTCFullYear();
}

function mondayOf(d: Date): Date {
  const day    = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday;
}

function toISO(d: Date): string {
  return `${isoWeekYear(d)}-W${String(isoWeekNumber(d)).padStart(2, "0")}`;
}

function rangeFromDate(d: Date): WeekRange {
  const monday = mondayOf(d);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { weekISO: toISO(monday), weekStart: monday, weekEnd: sunday };
}

function formatLabel(since: Date, until: Date): string {
  const opts:     Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: "numeric" };
  return `${since.toLocaleDateString("en-US", opts)} – ${until.toLocaleDateString("en-US", yearOpts)}`;
}

// ─── Week parser (for --week flag) ────────────────────────────────────────────

export function parseWeek(input: string = "last", timezone?: string): WeekRange {
  // Use wall-clock "now" in the user's timezone so that "last" and "this" respect
  // their local Monday, not UTC Monday.
  const now = timezone ? localNow(timezone) : new Date();

  if (input === "this") return rangeFromDate(now);
  if (input === "last") {
    const last = new Date(now); last.setUTCDate(now.getUTCDate() - 7);
    return rangeFromDate(last);
  }
  const isoMatch = /^(\d{4})-W(\d{1,2})$/.exec(input);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]!);
    const week = parseInt(isoMatch[2]!);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const weekOneMonday = mondayOf(jan4);
    const target = new Date(weekOneMonday);
    target.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);
    return rangeFromDate(target);
  }
  const nMatch = /^(\d+)$/.exec(input);
  if (nMatch) {
    const target = new Date(now);
    target.setUTCDate(now.getUTCDate() - parseInt(nMatch[1]!) * 7);
    return rangeFromDate(target);
  }
  const last = new Date(now); last.setUTCDate(now.getUTCDate() - 7);
  return rangeFromDate(last);
}

// ─── Flexible date range parser ────────────────────────────────────────────────

/**
 * Parse flexible date inputs into a DateRange.
 *
 * Accepts:
 *   week-based:  "last", "this", "2026-W12", "2" (weeks ago)
 *   rolling:     "7d", "14d", "30d"
 *   month:       "this-month", "last-month", "2026-03"
 *   explicit:    from+to as ISO date strings "2026-03-01"
 *
 * Pass `timezone` (IANA name, e.g. "Asia/Kolkata") to shift "last week" / "this week"
 * boundaries to the user's local Monday instead of UTC Monday.
 */
export function parseDateRange(opts: {
  week?:     string;
  range?:    string;
  from?:     string;
  to?:       string;
  timezone?: string;
}): DateRange {
  const tz  = opts.timezone;
  const now = tz ? localNow(tz) : new Date();

  // Explicit from/to
  if (opts.from) {
    const since = new Date(opts.from + "T00:00:00Z");
    const until = opts.to ? new Date(opts.to + "T23:59:59.999Z") : new Date();
    return { since, until, label: formatLabel(since, until) };
  }

  // Rolling days: "7d", "14d", "30d"
  if (opts.range) {
    const dMatch = /^(\d+)d$/.exec(opts.range);
    if (dMatch) {
      const days  = parseInt(dMatch[1]!);
      const since = new Date(now);
      since.setUTCDate(now.getUTCDate() - days);
      since.setUTCHours(0, 0, 0, 0);
      return { since, until: now, label: `Last ${days} days` };
    }

    if (opts.range === "this-month") {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return {
        since,
        until: now,
        label: `This month (${since.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })})`,
      };
    }

    if (opts.range === "last-month") {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return {
        since,
        until,
        label: `Last month (${since.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })})`,
      };
    }

    const monthMatch = /^(\d{4})-(\d{2})$/.exec(opts.range);
    if (monthMatch) {
      const year  = parseInt(monthMatch[1]!);
      const month = parseInt(monthMatch[2]!) - 1;
      const since = new Date(Date.UTC(year, month, 1));
      const until = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      return { since, until, label: formatLabel(since, until) };
    }
  }

  // Week-based (default) — timezone-aware
  const weekInput = opts.week ?? opts.range ?? "last";
  const wr        = parseWeek(weekInput, tz);
  return {
    since:   wr.weekStart,
    until:   wr.weekEnd,
    label:   formatLabel(wr.weekStart, wr.weekEnd),
    isoWeek: wr.weekISO,
  };
}

export function formatWeekLabel(range: WeekRange): string {
  return formatLabel(range.weekStart, range.weekEnd);
}

export const DEFAULT_WEEK = "last";
