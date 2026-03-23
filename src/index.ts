import { Hono } from "hono";
import type { Env, DiscordInteraction } from "./types";
import { verifyDiscordSignature } from "./discord/interactions";
import { routeInteraction } from "./discord/commands/index";
import { buildChangelogsForGroup, buildChangelogForUser } from "./gitlab/changelog";
import { generateAISummary } from "./ai/summarize";
import { buildChangelogEmbed } from "./discord/embeds";
import { parseDateRange } from "./utils/weeks";
import { getGlobalConfig, resolveFilters } from "./kv/config";
import { saveRunRecord } from "./kv/run-history";
import { wasPosted, markPosted } from "./kv/dedup";
import { listTeams } from "./kv/teams";

const app = new Hono<{ Bindings: Env }>();

app.post("/interactions", async (c) => {
  const rawBody = await c.req.text();
  const valid   = await verifyDiscordSignature(c.req.raw, rawBody, c.env.DISCORD_PUBLIC_KEY);
  if (!valid) return c.json({ error: "Unauthorized" }, 401);
  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  return await routeInteraction(interaction, c.env, c.executionCtx);
});

app.get("/health", (c) => c.json({ ok: true, version: "3.1.0" }));

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeeklyChangelogs(env));
  },
};

async function postToChannel(channelId: string, body: object, botToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runWeeklyChangelogs(env: Env): Promise<void> {
  const startMs      = Date.now();
  const globalConfig = await getGlobalConfig(env.USERS_KV);
  const filters      = resolveFilters(globalConfig);
  const dateRange    = parseDateRange({ week: "last" });
  const isoWeek      = dateRange.isoWeek ?? dateRange.label;

  let totalProcessed = 0;
  let posted   = 0;
  let failed   = 0;
  let skipped  = 0;
  const errors: string[] = [];

  const channelId = env.DISCORD_CHANGELOG_CHANNEL_ID;

  // ── 1. Per-team digests (if any teams are configured with a custom channel) ─
  try {
    const teams = await listTeams(env.USERS_KV);
    for (const team of teams) {
      if (!team.channelId) continue; // only post to teams that have a dedicated channel
      const teamChannel = team.channelId;

      for (const username of team.members) {
        totalProcessed++;
        try {
          if (await wasPosted(env.USERS_KV, isoWeek, username)) { skipped++; continue; }

          const data = await buildChangelogForUser(username, username, env, dateRange, globalConfig.defaultStyle, filters);
          if (data.mergedMRs.length === 0 && data.staleMRs.length === 0 && data.openMRs.length === 0) continue;

          data.aiSummary = await generateAISummary(env.AI, data, globalConfig.defaultStyle);
          const ok = await postToChannel(teamChannel, buildChangelogEmbed(data), env.DISCORD_BOT_TOKEN);
          if (ok) { posted++; await markPosted(env.USERS_KV, isoWeek, username); }
          else    { failed++; errors.push(`Team ${team.name}/${username}: Discord post failed`); }
        } catch (err) {
          failed++;
          errors.push(`Team ${team.name}/${username}: ${String(err).slice(0, 100)}`);
          console.error(`Weekly team post failed for ${team.name}/${username}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Team digest error:", err);
    errors.push(`Team digest: ${String(err).slice(0, 100)}`);
  }

  // ── 2. Global group digest → main changelog channel ─────────────────────────
  try {
    const changelogs = await buildChangelogsForGroup(
      env.GITLAB_GROUP_ID, env, dateRange, globalConfig.defaultStyle, filters
    );

    for (const data of changelogs) {
      totalProcessed++;
      try {
        if (await wasPosted(env.USERS_KV, isoWeek, data.gitlabUsername)) { skipped++; continue; }
        if (data.mergedMRs.length === 0 && data.staleMRs.length === 0 && data.openMRs.length === 0) continue;

        data.aiSummary = await generateAISummary(env.AI, data, globalConfig.defaultStyle);
        const ok = await postToChannel(channelId, buildChangelogEmbed(data), env.DISCORD_BOT_TOKEN);
        if (ok) { posted++; await markPosted(env.USERS_KV, isoWeek, data.gitlabUsername); }
        else    { failed++; errors.push(`${data.gitlabUsername}: Discord post failed`); }
      } catch (err) {
        failed++;
        errors.push(`${data.gitlabUsername}: ${String(err).slice(0, 100)}`);
        console.error(`Weekly changelog failed for ${data.gitlabUsername}:`, err);
      }
    }
  } catch (err) {
    failed++;
    errors.push(`Group digest: ${String(err).slice(0, 100)}`);
    console.error("Group digest error:", err);
  }

  const durationMs = Date.now() - startMs;
  console.log(`Weekly run: ${posted} posted, ${failed} failed, ${skipped} skipped, ${totalProcessed} processed, ${durationMs}ms`);

  // ── 3. Save run record for /changelog last-run ───────────────────────────────
  await saveRunRecord(env.USERS_KV, {
    triggeredAt:      new Date().toISOString(),
    triggerType:      "cron",
    durationMs,
    membersProcessed: totalProcessed,
    posted,
    failed,
    skipped,
    errors: errors.slice(0, 10),
  }).catch((e) => console.error("Failed to save run record:", e));
}
