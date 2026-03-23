import type { Env, DiscordInteraction, DiscordCommandOption, ChangelogData } from "../../types";
import { InteractionResponseType } from "../../types";
import { handleGenerate } from "./generate";
import { handleLink, handleUnlink, handleList } from "./register";
import { handleHealth } from "./health";
import { handleConfig } from "./config";
import { handleStats } from "./stats";
import { handleRelease } from "./release";
import { buildChangelogEmbed } from "../embeds";
import { handleAutocomplete } from "../autocomplete";

function getUserId(i: DiscordInteraction): string {
  return i.member?.user.id ?? i.user?.id ?? "";
}

/**
 * Route an incoming Discord interaction.
 *
 * Type 1 = PING            → synchronous PONG
 * Type 2 = APPLICATION_COMMAND → defer immediately, work in waitUntil
 * Type 3 = MESSAGE_COMPONENT   → defer UPDATE, work in waitUntil
 * Type 4 = AUTOCOMPLETE        → must respond synchronously (with actual data)
 */
export async function routeInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Ping
  if (interaction.type === 1) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  // Autocomplete — must respond synchronously with choices
  if (interaction.type === 4) {
    return handleAutocomplete(interaction, env);
  }

  // Button / select components
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id ?? "";
    ctx.waitUntil(handleComponent(customId, env));
    return Response.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  // Slash commands — ACK immediately, do all work in background
  if (interaction.type === 2) {
    const commandName = interaction.data?.name ?? "";
    const options = interaction.data?.options ?? [];
    const sub = options[0];
    const subName = sub?.name ?? "";
    const subOpts = sub?.options ?? [];
    const appId = env.DISCORD_APPLICATION_ID;
    const token = interaction.token;
    const userId = getUserId(interaction);

    if (commandName === "changelog") {
      ctx.waitUntil(dispatchChangelog(subName, subOpts, appId, token, env, userId));
      return Response.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }

    if (commandName === "release") {
      ctx.waitUntil(dispatchRelease(subName, subOpts, appId, token, env));
      return Response.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 },
      });
    }
  }

  return Response.json({ type: InteractionResponseType.PONG });
}

async function dispatchChangelog(
  sub: string, opts: DiscordCommandOption[],
  appId: string, token: string, env: Env, userId: string
): Promise<void> {
  switch (sub) {
    case "generate": return handleGenerate(appId, token, opts, env, userId);
    case "link":     return handleLink(appId, token, opts, env);
    case "unlink":   return handleUnlink(appId, token, opts, env);
    case "list":     return handleList(appId, token, env);
    case "health":   return handleHealth(appId, token, env);
    case "stats":    return handleStats(appId, token, opts, env, userId);
    case "config": {
      const inner = opts[0];
      if (!inner) return;
      return handleConfig(appId, token, inner.name, inner.options ?? [], env, userId);
    }
    default:
      await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `❓ Unknown subcommand: \`${sub}\`` }),
      });
  }
}

async function dispatchRelease(
  sub: string, opts: DiscordCommandOption[],
  appId: string, token: string, env: Env
): Promise<void> {
  if (sub === "generate") return handleRelease(appId, token, opts, env);
}

async function handleComponent(customId: string, env: Env): Promise<void> {
  const idx = customId.indexOf(":");
  if (idx === -1) return;
  const action = customId.slice(0, idx);
  const jobKey = customId.slice(idx + 1);

  if (action === "changelog_discard") {
    await env.USERS_KV.delete(`preview:${jobKey}`);
    return;
  }

  if (action === "changelog_approve") {
    const raw = await env.USERS_KV.get(`preview:${jobKey}`);
    if (!raw) return;
    const data = JSON.parse(raw) as ChangelogData;
    const embed = buildChangelogEmbed(data);
    await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(embed),
    });
    await env.USERS_KV.delete(`preview:${jobKey}`);
  }
}
