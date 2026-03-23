import { Hono } from "hono";
import type { Env, DiscordInteraction } from "./types";
import { verifyDiscordSignature } from "./discord/interactions";
import { routeInteraction } from "./discord/commands/index";
import { buildChangelogsForGroup } from "./gitlab/changelog";
import { generateAISummary } from "./ai/summarize";
import { buildChangelogEmbed } from "./discord/embeds";
import { parseDateRange } from "./utils/weeks";
import { getGlobalConfig, resolveFilters } from "./kv/config";

const app = new Hono<{ Bindings: Env }>();

app.post("/interactions", async (c) => {
  const rawBody = await c.req.text();
  const valid = await verifyDiscordSignature(c.req.raw, rawBody, c.env.DISCORD_PUBLIC_KEY);
  if (!valid) return c.json({ error: "Unauthorized" }, 401);
  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  return await routeInteraction(interaction, c.env, c.executionCtx);
});

app.get("/health", (c) => c.json({ ok: true, version: "3.0.0" }));

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeeklyChangelogs(env));
  },
};

async function runWeeklyChangelogs(env: Env): Promise<void> {
  const globalConfig = await getGlobalConfig(env.USERS_KV);
  const filters = resolveFilters(globalConfig);
  const dateRange = parseDateRange({ week: "last" });

  const changelogs = await buildChangelogsForGroup(
    env.GITLAB_GROUP_ID, env, dateRange, globalConfig.defaultStyle, filters
  );

  let posted = 0;
  let failed = 0;

  for (const data of changelogs) {
    try {
      // Skip users with zero activity AND zero blockers (noise reduction)
      if (data.mergedMRs.length === 0 && data.staleMRs.length === 0 && data.openMRs.length === 0) continue;

      data.aiSummary = await generateAISummary(env.AI, data, globalConfig.defaultStyle);
      const embed = buildChangelogEmbed(data);

      const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(embed),
      });

      if (res.ok) posted++;
      else { failed++; console.error(`Weekly post failed for ${data.gitlabUsername}: ${res.status}`); }
    } catch (err) {
      failed++;
      console.error(`Weekly changelog failed for ${data.gitlabUsername}:`, err);
    }
  }

  console.log(`Weekly run complete: ${posted} posted, ${failed} failed, ${changelogs.length} total members`);
}
