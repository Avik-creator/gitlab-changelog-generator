import { Hono } from "hono";
import type { DiscordInteraction, Env } from "./types";
import { InteractionResponseType, InteractionType } from "./types";
import { verifyDiscordSignature } from "./discord/interactions";
import { routeCommand } from "./discord/commands";
import { buildChangelogForUser, getWeekRange } from "./gitlab/changelog";
import { generateAISummary } from "./ai/summarize";
import { getAllUsers } from "./kv/users";
import { buildChangelogEmbed } from "./discord/embeds";

const DISCORD_API = "https://discord.com/api/v10";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (c) => c.text("GitLab Changelog Bot is running ✓"));

// ---------------------------------------------------------------------------
// Discord interactions endpoint
// ---------------------------------------------------------------------------
app.post("/interactions", async (c) => {
  const signature = c.req.header("x-signature-ed25519") ?? "";
  const timestamp = c.req.header("x-signature-timestamp") ?? "";
  const body = await c.req.text();

  const isValid = await verifyDiscordSignature(
    c.env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    body
  );

  if (!isValid) {
    return c.text("Invalid request signature", 401);
  }

  const interaction = JSON.parse(body) as DiscordInteraction;

  // Respond to Discord's PING verification
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  // Slash command received
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { id: appId, token } = interaction;

    // Immediately acknowledge — we have 3 seconds to respond
    // The actual work runs in waitUntil() after the response is sent
    c.executionCtx.waitUntil(
      routeCommand(c.env.DISCORD_APPLICATION_ID, token, interaction.data?.options, c.env)
    );

    return c.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
  }

  return c.json({ error: "Unknown interaction type" }, 400);
});

// ---------------------------------------------------------------------------
// Manual trigger for testing (protected by a simple token header)
// ---------------------------------------------------------------------------
app.post("/trigger/weekly", async (c) => {
  const authHeader = c.req.header("x-trigger-token");
  if (authHeader !== c.env.DISCORD_BOT_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.executionCtx.waitUntil(runWeeklyChangelogs(c.env));
  return c.json({ status: "Weekly changelog generation started" });
});

// ---------------------------------------------------------------------------
// Weekly scheduled task — Cloudflare Cron Trigger
// ---------------------------------------------------------------------------
async function runWeeklyChangelogs(env: Env): Promise<void> {
  const users = await getAllUsers(env.USERS_KV);
  if (users.length === 0) {
    console.log("No registered users — skipping weekly changelog.");
    return;
  }

  const { weekStart, weekEnd } = getWeekRange();
  console.log(`Generating changelogs for ${users.length} users (${weekStart.toDateString()} – ${weekEnd.toDateString()})`);

  for (const user of users) {
    try {
      const changelogData = await buildChangelogForUser(user, env, weekStart, weekEnd);
      changelogData.aiSummary = await generateAISummary(env.AI, changelogData, "changelog");
      const embed = buildChangelogEmbed(changelogData, "changelog");

      const res = await fetch(
        `${DISCORD_API}/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify(embed),
        }
      );

      if (!res.ok) {
        console.error(`Discord post failed for ${user.gitlabUsername}:`, await res.text());
      } else {
        console.log(`✓ Posted changelog for ${user.gitlabUsername}`);
      }
    } catch (err) {
      console.error(`Failed to generate changelog for ${user.gitlabUsername}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — Hono handles fetch, CF handles scheduled cron
// ---------------------------------------------------------------------------
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWeeklyChangelogs(env));
  },
};
