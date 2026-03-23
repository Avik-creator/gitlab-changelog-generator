import type { Env, DiscordCommandOption, DigestMode } from "../../types";
import {
  buildChangelogForUser,
  buildChangelogsForGroup,
  buildChangelogForProject,
  buildChangelogForLabel,
  buildChangelogForMilestone,
  computeUserStats,
} from "../../gitlab/changelog";
import { generateAISummary } from "../../ai/summarize";
import { buildChangelogEmbed, buildErrorEmbed, buildPreviewComponents, MR_PAGE_SIZE } from "../embeds";
import { getGitlabUsername } from "../../kv/users";
import { getGlobalConfig, getUserConfig, resolveFilters, resolveStyle } from "../../kv/config";
import { GitLabClient } from "../../gitlab/client";
import { parseDateRange } from "../../utils/weeks";
import { cacheStats, getCachedStats } from "../../kv/stats-cache";
import { computeTrend, previousPeriodLabel } from "../../gitlab/trends";
import { postThreadedDigest } from "../thread";
import { getTeam } from "../../kv/teams";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}
function getBool(opts: DiscordCommandOption[], name: string): boolean {
  return (opts.find((o) => o.name === name)?.value as boolean) ?? false;
}

const VALID_MODES: DigestMode[] = ["changelog", "pr", "press-release", "release-notes", "concise", "manager", "engineering", "executive"];
function coerceMode(raw?: string): DigestMode | undefined {
  return VALID_MODES.includes(raw as DigestMode) ? (raw as DigestMode) : undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function postToChannel(channelId: string, body: object, botToken: string): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "(unreadable)");
    console.error(`Discord post failed ${res.status}:`, errorBody);
    throw new Error(`Discord post failed: ${res.status} — ${errorBody.slice(0, 300)}`);
  }
}

export async function handleGenerate(
  appId: string, token: string, options: DiscordCommandOption[],
  env: Env, requesterId: string
): Promise<void> {
  const userOpt      = getOpt(options, "user");
  const gitlabOpt    = getOpt(options, "gitlab");
  const projectOpt   = getOpt(options, "project");
  const labelOpt     = getOpt(options, "label");
  const milestoneOpt = getOpt(options, "milestone");
  const teamOpt      = getOpt(options, "team");
  const weekOpt      = getOpt(options, "week");
  const rangeOpt     = getOpt(options, "range");
  const fromOpt      = getOpt(options, "from");
  const toOpt        = getOpt(options, "to");
  const modeOpt      = coerceMode(getOpt(options, "mode"));
  const preview      = getBool(options, "preview");
  const allFlag      = getBool(options, "all");
  const threadMode   = getBool(options, "thread");

  const globalConfig = await getGlobalConfig(env.USERS_KV);
  const userConfig   = await getUserConfig(env.USERS_KV, requesterId);
  const filters      = resolveFilters(globalConfig, userConfig);
  const mode         = modeOpt ?? resolveStyle(globalConfig, userConfig);
  const verbosity    = userConfig.verbosity as "brief" | "normal" | "detailed" | undefined;

  // Use the requester's timezone to shift "last week" / "this week" boundaries
  const timezone  = userConfig.timezone ?? "UTC";
  const dateRange = parseDateRange({ week: weekOpt, range: rangeOpt, from: fromOpt, to: toOpt, timezone });

  try {
    // ── Named team scope ─────────────────────────────────────────────────────
    if (teamOpt) {
      const team = await getTeam(env.USERS_KV, teamOpt);
      if (!team) {
        await patch(appId, token, buildErrorEmbed("Team not found", `Team \`${teamOpt}\` doesn't exist. Use \`/changelog team create\` to add it.`));
        return;
      }

      const changelogs = await Promise.allSettled(
        team.members.map((username) =>
          buildChangelogForUser(username, username, env, dateRange, mode, filters)
        )
      );

      const resolved = changelogs
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof buildChangelogForUser>>> => r.status === "fulfilled")
        .map((r) => r.value);

      for (const data of resolved) {
        if (data.mergedMRs.length === 0 && data.staleMRs.length === 0) continue;
        data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);
      }

      const channelId = team.channelId ?? env.DISCORD_CHANGELOG_CHANNEL_ID;
      let posted = 0;
      for (const data of resolved) {
        if (data.mergedMRs.length === 0 && data.staleMRs.length === 0) continue;
        await postToChannel(channelId, buildChangelogEmbed(data), env.DISCORD_BOT_TOKEN);
        posted++;
      }
      await patch(appId, token, { content: `✅ Posted changelogs for **${posted}** member(s) in team \`${team.name}\` — ${dateRange.label}.` });
      return;
    }

    // ── All group members ─────────────────────────────────────────────────────
    if (allFlag) {
      const changelogs = await buildChangelogsForGroup(env.GITLAB_GROUP_ID, env, dateRange, mode, filters);
      const period     = dateRange.isoWeek ?? dateRange.label;
      const prevLabel  = previousPeriodLabel(dateRange.isoWeek ?? "");

      for (const data of changelogs) {
        if (data.mergedMRs.length === 0 && data.staleMRs.length === 0) continue;
        data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);

        const stats = await computeUserStats(data.gitlabUsername, data.displayName, env, dateRange, filters).catch(() => null);
        if (stats) {
          await cacheStats(env.USERS_KV, period, stats);
          const prevStats = await getCachedStats(env.USERS_KV, prevLabel, data.gitlabUsername).catch(() => null);
          if (prevStats) data.trend = computeTrend(stats, prevStats, prevLabel);
        }
      }

      if (threadMode) {
        const result = await postThreadedDigest({
          channelId: env.DISCORD_CHANGELOG_CHANNEL_ID,
          botToken:  env.DISCORD_BOT_TOKEN,
          changelogs,
          mode,
          periodLabel: dateRange.label,
        });
        await patch(appId, token, {
          content: `✅ Thread posted: **${result.posted}** members, **${result.skipped}** skipped — ${dateRange.label}.`,
        });
      } else {
        let posted = 0;
        for (const data of changelogs) {
          if (data.mergedMRs.length === 0 && data.staleMRs.length === 0) continue;
          await postToChannel(env.DISCORD_CHANGELOG_CHANNEL_ID, buildChangelogEmbed(data), env.DISCORD_BOT_TOKEN);
          posted++;
        }
        await patch(appId, token, { content: `✅ Posted changelogs for **${posted}** member(s) — ${dateRange.label}.` });
      }
      return;
    }

    // ── Project scope ─────────────────────────────────────────────────────────
    if (projectOpt) {
      const data = await buildChangelogForProject(projectOpt, env, dateRange, mode, filters);
      data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);
      return await finishAndPost(appId, token, env, data, preview);
    }

    // ── Label scope ───────────────────────────────────────────────────────────
    if (labelOpt) {
      const data = await buildChangelogForLabel(labelOpt, env, dateRange, mode, filters);
      data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);
      return await finishAndPost(appId, token, env, data, preview);
    }

    // ── Milestone scope ───────────────────────────────────────────────────────
    if (milestoneOpt) {
      const data = await buildChangelogForMilestone(milestoneOpt, env, mode, filters);
      data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);
      return await finishAndPost(appId, token, env, data, preview);
    }

    // ── Single user ───────────────────────────────────────────────────────────
    let gitlabUsername: string;
    let displayName: string;

    if (gitlabOpt) {
      gitlabUsername = gitlabOpt.replace(/^gitlab:/i, "").trim();
      displayName    = gitlabUsername;
      try {
        const client  = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
        const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
        const found   = members.find((m) => m.username === gitlabUsername);
        if (found) displayName = found.name;
      } catch { /* best-effort */ }

    } else if (userOpt) {
      const cleanId = userOpt.replace(/[<@!>]/g, "").trim();
      const mapped  = await getGitlabUsername(env.USERS_KV, cleanId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed("User not linked", `<@${cleanId}> hasn't linked their GitLab. Use \`/changelog link\` or pass \`gitlab:username\`.`));
        return;
      }
      gitlabUsername = mapped;
      displayName    = gitlabUsername;

    } else {
      const mapped = await getGitlabUsername(env.USERS_KV, requesterId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed("Not linked", "Use `/changelog link` first, or pass `gitlab:your_username`."));
        return;
      }
      gitlabUsername = mapped;
      displayName    = gitlabUsername;
    }

    // Use the target user's timezone if we looked them up
    const targetTimezone = gitlabOpt || userOpt
      ? "UTC"
      : timezone; // only apply requester timezone when generating for self

    const userDateRange = parseDateRange({
      week: weekOpt, range: rangeOpt, from: fromOpt, to: toOpt,
      timezone: targetTimezone,
    });

    const data = await buildChangelogForUser(gitlabUsername, displayName, env, userDateRange, mode, filters);
    data.aiSummary = await generateAISummary(env.AI, data, mode, verbosity);

    // Cache stats + attach trend
    const period    = userDateRange.isoWeek ?? userDateRange.label;
    const prevLabel = previousPeriodLabel(userDateRange.isoWeek ?? "");
    const stats = await computeUserStats(gitlabUsername, displayName, env, userDateRange, filters).catch(() => null);
    if (stats) {
      await cacheStats(env.USERS_KV, period, stats);
      const prevStats = await getCachedStats(env.USERS_KV, prevLabel, gitlabUsername).catch(() => null);
      if (prevStats) data.trend = computeTrend(stats, prevStats, prevLabel);
    }

    return await finishAndPost(appId, token, env, data, preview);

  } catch (err) {
    console.error("handleGenerate error:", err);
    await patch(appId, token, buildErrorEmbed("Generation failed", `\`\`\`\n${String(err).slice(0, 500)}\n\`\`\``));
  }
}

function makeJobKey(data: import("../../types").ChangelogData): string {
  const scope  = data.scope.value || data.gitlabUsername || "unknown";
  const period = data.weekISO || data.dateRange.label;
  return `${scope}_${period}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 60);
}

async function finishAndPost(
  appId: string, token: string, env: Env,
  data: import("../../types").ChangelogData, preview: boolean
): Promise<void> {
  const jobKey    = makeJobKey(data);
  const totalPages = Math.ceil((data.mergedMRs.length || 1) / MR_PAGE_SIZE);
  const isPaginated = totalPages > 1;

  // Always store for pagination lookups (1hr TTL)
  if (isPaginated) {
    await env.USERS_KV.put(
      `mrpages:${jobKey}`,
      JSON.stringify({ data, totalPages }),
      { expirationTtl: 3600 }
    );
  }

  const embedOpts = isPaginated ? { page: 0, jobKey, totalPages } : {};

  if (preview) {
    await env.USERS_KV.put(`preview:${jobKey}`, JSON.stringify(data), { expirationTtl: 3600 });
    const embed = buildChangelogEmbed(data, embedOpts);
    await patch(appId, token, {
      ...(embed as Record<string, unknown>),
      content: `👀 **Preview** — ${data.dateRange.label}. Approve to post publicly.`,
      components: [
        ...(buildPreviewComponents(jobKey) as object[]),
        // pagination buttons are already embedded inside buildChangelogEmbed's components
      ],
      flags: 64,
    });
    return;
  }

  const embed = buildChangelogEmbed(data, embedOpts);
  await postToChannel(env.DISCORD_CHANGELOG_CHANNEL_ID, embed, env.DISCORD_BOT_TOKEN);
  await patch(appId, token, { content: `✅ Changelog for **${data.displayName}** posted — ${data.dateRange.label}.` });
}
