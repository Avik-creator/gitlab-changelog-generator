import type { Env, DiscordInteraction, DiscordCommandOption } from "../../types";
import { InteractionResponseType } from "../../types";
import { handleGenerate } from "./generate";
import { handleLink, handleUnlink, handleList } from "./register";
import { handleHealth } from "./health";
import { buildChangelogEmbed, buildErrorEmbed } from "../embeds";

function getUserId(i: DiscordInteraction): string {
  return i.member?.user.id ?? i.user?.id ?? "";
}

export function routeInteraction(
  interaction: DiscordInteraction,
  env: Env,
  ctx: ExecutionContext
): Response {
  // Ping
  if (interaction.type === 1) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  // Button components (preview approve/discard)
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id ?? "";
    ctx.waitUntil(handleComponent(customId, env));
    return Response.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  // Slash commands
  if (interaction.type === 2) {
    const options  = interaction.data?.options ?? [];
    const sub      = options[0];
    const subName  = sub?.name ?? "";
    const subOpts  = sub?.options ?? [];
    const appId    = env.DISCORD_APPLICATION_ID;
    const token    = interaction.token;
    const userId   = getUserId(interaction);

    ctx.waitUntil(dispatch(subName, subOpts, appId, token, env, userId));

    return Response.json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
  }

  return Response.json({ type: InteractionResponseType.PONG });
}

async function dispatch(
  subName: string,
  options: DiscordCommandOption[],
  appId: string,
  token: string,
  env: Env,
  userId: string
): Promise<void> {
  switch (subName) {
    case "generate": return handleGenerate(appId, token, options, env, userId);
    case "link":     return handleLink(appId, token, options, env);
    case "unlink":   return handleUnlink(appId, token, options, env);
    case "list":     return handleList(appId, token, env);
    case "health":   return handleHealth(appId, token, env);
    default:
      await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `❓ Unknown subcommand: \`${subName}\`` }),
      });
  }
}

// ─── Preview approve/discard ──────────────────────────────────────────────────

async function handleComponent(customId: string, env: Env): Promise<void> {
  const colonIdx = customId.indexOf(":");
  if (colonIdx === -1) return;
  const action  = customId.slice(0, colonIdx);
  const jobKey  = customId.slice(colonIdx + 1);

  if (action === "changelog_discard") {
    await env.USERS_KV.delete(`preview:${jobKey}`);
    return;
  }

  if (action === "changelog_approve") {
    const raw = await env.USERS_KV.get(`preview:${jobKey}`);
    if (!raw) return;

    const data = JSON.parse(raw) as import("../../types").ChangelogData;
    const embed = buildChangelogEmbed(data, data.format);

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
