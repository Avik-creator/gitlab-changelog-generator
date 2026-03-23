import { Hono } from "hono";
import type { Env, DiscordInteraction } from "./types";
import { verifyDiscordSignature } from "./discord/interactions";
import { routeInteraction } from "./discord/commands/index";
import { buildChangelogForGroup } from "./gitlab/changelog";
import { generateAISummary } from "./ai/summarize";
import { buildChangelogEmbed } from "./discord/embeds";
import { parseWeek } from "./utils/weeks";

const app = new Hono<{ Bindings: Env }>();

app.post("/discord/interactions", async (c) => {
  const rawBody = await c.req.text();
  const valid = await verifyDiscordSignature(c.req.raw, rawBody, c.env.DISCORD_PUBLIC_KEY);
  if (!valid) return c.json({ error: "Unauthorized" }, 401);

  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  return routeInteraction(interaction, c.env, c.executionCtx);
});

app.get("/health", (c) => c.json({ ok: true, version: "2.1.0" }));

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeeklyChangelogs(env));
  },
};

// ─── Weekly cron — pulls members straight from GitLab, no registry ───────────

async function runWeeklyChangelogs(env: Env): Promise<void> {
  const week = parseWeek("last");

  // One API call gets all group members — that's our user list
  const changelogs = await buildChangelogForGroup(env.GITLAB_GROUP_ID, env, week.weekISO, "changelog");

  for (const data of changelogs) {
    try {
      data.aiSummary = await generateAISummary(env.AI, data, "changelog");
      const embed = buildChangelogEmbed(data, "changelog");

      await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(embed),
      });
    } catch (err) {
      console.error(`Weekly changelog failed for ${data.gitlabUsername}:`, err);
    }
  }
}
