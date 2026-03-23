/**
 * Trend / comparison utilities.
 *
 * Given stats for the current period and (optionally) the previous equivalent
 * period, compute deltas and format them for Discord.
 */

import type { UserStats, TrendData } from "../types";

// ─── Core delta computation ────────────────────────────────────────────────────

export function computeTrend(
  current: UserStats,
  prev: UserStats | null,
  prevLabel: string
): TrendData {
  const prevMRs     = prev?.mrsMerged ?? 0;
  const prevLines   = (prev?.totalAdditions ?? 0) + (prev?.totalDeletions ?? 0);
  const prevReviews = prev?.reviewActivity?.reviewsGiven ?? 0;
  const prevRepos   = prev?.reposContributed?.length ?? 0;

  return {
    mrsDelta:     current.mrsMerged                                       - prevMRs,
    linesDelta:   (current.totalAdditions + current.totalDeletions)       - prevLines,
    reviewsDelta: current.reviewActivity.reviewsGiven                     - prevReviews,
    reposDelta:   current.reposContributed.length                        - prevRepos,
    prevLabel,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function arrow(n: number, invert = false): string {
  if (n === 0) return "—";
  const up = invert ? n < 0 : n > 0;
  return up ? `▲ +${Math.abs(n)}` : `▼ -${Math.abs(n)}`;
}

/** Returns a compact one-line Discord-friendly string, e.g.:
 *  "vs 2026-W11 · MRs ▲ +2 · Lines ▲ +840 · Reviews — · Repos ▲ +1"
 */
export function formatTrendLine(trend: TrendData): string {
  const parts = [
    `MRs ${arrow(trend.mrsDelta)}`,
    `Lines ${arrow(trend.linesDelta)}`,
    `Reviews ${arrow(trend.reviewsDelta)}`,
  ];
  if (trend.reposDelta !== 0) parts.push(`Repos ${arrow(trend.reposDelta)}`);
  return `vs ${trend.prevLabel} · ${parts.join(" · ")}`;
}

/** Returns a human-readable previous period label given an ISO week string.
 *  "2026-W12" → "2026-W11"
 *  For non-week labels we just return "previous period".
 */
export function previousPeriodLabel(currentLabel: string): string {
  const m = currentLabel.match(/^(\d{4})-W(\d+)$/);
  if (m && m[1] && m[2]) {
    const year = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);
    if (week === 1) return `${year - 1}-W52`;
    return `${year}-W${String(week - 1).padStart(2, "0")}`;
  }
  return "previous period";
}
