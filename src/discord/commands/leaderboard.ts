/**
 * /changelog leaderboard
 *
 * Ranks every active GitLab group member by a chosen metric for a given period.
 * Metrics: mrs (default), lines, reviews, speed
 *
 * Supports trend comparison vs. the previous equivalent period.
 */

import type { Env, DiscordCommandOption, UserStats } from "../../types";
import { computeUserStatsLite } from "../../gitlab/changelog";
import { GitLabClient } from "../../gitlab/client";
import { getGlobalConfig, getUserConfig, resolveFilters } from "../../kv/config";
import { parseDateRange } from "../../utils/weeks";
import { getOrComputeStats, getCachedStats } from "../../kv/stats-cache";
import { computeTrend, previousPeriodLabel } from "../../gitlab/trends";
import {
  buildLeaderboardEmbed,
  buildErrorEmbed,
  type LeaderboardMetric,
} from "../embeds";

const VALID_METRICS: LeaderboardMetric[] = ["mrs", "lines", "reviews", "speed"];

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function handleLeaderboard(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env,
  userId: string
): Promise<void> {
  const metricRaw  = getOpt(options, "metric") as LeaderboardMetric | undefined;
  const weekOpt    = getOpt(options, "week");
  const rangeOpt   = getOpt(options, "range");
  const fromOpt    = getOpt(options, "from");
  const toOpt      = getOpt(options, "to");
  const showTrend  = (options.find((o) => o.name === "trend")?.value as boolean) ?? true;

  const metric = VALID_METRICS.includes(metricRaw as LeaderboardMetric)
    ? (metricRaw as LeaderboardMetric)
    : "mrs";

  const globalConfig = await getGlobalConfig(env.USERS_KV);
  const userConfig   = await getUserConfig(env.USERS_KV, userId);
  const filters      = resolveFilters(globalConfig, userConfig);
  const dateRange    = parseDateRange({ week: weekOpt, range: rangeOpt, from: fromOpt, to: toOpt });

  try {
    const client  = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    const members = await client.getGroupMembers(env.GITLAB_GROUP_ID, true);

    if (members.length === 0) {
      await patch(appId, token, buildErrorEmbed("No members", "No active members found in the GitLab group."));
      return;
    }

    // Process members sequentially — avoids blowing the 50-subrequest limit.
    // Each member costs ~2 API calls (MR list + review activity) via the lite path.
    // KV cache is checked first so subsequent calls are free.
    const period = dateRange.isoWeek ?? dateRange.label;
    const prevPeriod = previousPeriodLabel(dateRange.isoWeek ?? "");

    const statsList: UserStats[] = [];
    for (const m of members) {
      try {
        const stats = await getOrComputeStats(env.USERS_KV, period, m.username, () =>
          computeUserStatsLite(m.username, m.name, env, dateRange, filters)
        );
        statsList.push(stats);
      } catch (err) {
        console.error(`Stats failed for ${m.username}:`, err);
      }
    }

    // Sort by chosen metric
    const sorted = [...statsList].sort((a, b) => {
      switch (metric) {
        case "mrs":     return b.mrsMerged - a.mrsMerged;
        case "lines":   return (b.totalAdditions + b.totalDeletions) - (a.totalAdditions + a.totalDeletions);
        case "reviews": return b.reviewActivity.reviewsGiven - a.reviewActivity.reviewsGiven;
        case "speed":   {
          // Fastest = lowest avg hours, but push zeros to the bottom
          const aTime = a.mrsMerged > 0 ? a.avgTimeToMerge : Infinity;
          const bTime = b.mrsMerged > 0 ? b.avgTimeToMerge : Infinity;
          return aTime - bTime;
        }
      }
    });

    // Optionally attach trend data (compare vs. previous period)
    const entries = await Promise.all(
      sorted.map(async (stats, i) => {
        if (!showTrend) return { rank: i + 1, stats };
        const prevStats = await getCachedStats(env.USERS_KV, prevPeriod, stats.username).catch(() => null);
        const trend = prevStats
          ? computeTrend(stats, prevStats, prevPeriod)
          : undefined;
        return { rank: i + 1, stats, trend };
      })
    );

    await patch(appId, token, buildLeaderboardEmbed(entries, metric, dateRange.label));
  } catch (err) {
    console.error("handleLeaderboard error:", err);
    await patch(appId, token, buildErrorEmbed("Leaderboard failed", `\`\`\`\n${String(err).slice(0, 500)}\n\`\`\``));
  }
}
