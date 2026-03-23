import type { Env, DiscordCommandOption } from "../../types";
import { getTeam, upsertTeam, deleteTeam, listTeams } from "../../kv/teams";
import { buildErrorEmbed } from "../embeds";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

// ─── /changelog team create ────────────────────────────────────────────────────

async function handleTeamCreate(
  appId: string, token: string,
  opts: DiscordCommandOption[], env: Env
): Promise<void> {
  const name      = getOpt(opts, "name");
  const membersRaw = getOpt(opts, "members");
  const channelId = getOpt(opts, "channel");

  if (!name) {
    await patch(appId, token, buildErrorEmbed("Missing field", "Team `name` is required."));
    return;
  }
  if (!membersRaw) {
    await patch(appId, token, buildErrorEmbed("Missing field", "Provide `members` as a comma-separated list of GitLab usernames."));
    return;
  }

  const members = membersRaw.split(",").map((m) => m.trim()).filter(Boolean);
  if (members.length === 0) {
    await patch(appId, token, buildErrorEmbed("Invalid members", "Provide at least one GitLab username."));
    return;
  }

  const team = await upsertTeam(env.USERS_KV, name, members, channelId);
  await patch(appId, token, {
    embeds: [{
      title: `✅ Team \`${team.name}\` saved`,
      color: 0x27ae60,
      fields: [
        { name: "Members", value: team.members.map((m) => `\`${m}\``).join(", "), inline: false },
        { name: "Discord Channel", value: team.channelId ? `<#${team.channelId}>` : "_not set_", inline: true },
      ],
      footer: { text: "GitLab Changelog Bot" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─── /changelog team list ─────────────────────────────────────────────────────

async function handleTeamList(appId: string, token: string, env: Env): Promise<void> {
  const teams = await listTeams(env.USERS_KV);
  if (teams.length === 0) {
    await patch(appId, token, { content: "No teams configured yet. Use `/changelog team create` to add one." });
    return;
  }

  const fields = teams.map((t) => ({
    name: `👥 ${t.name}`,
    value: [
      `Members: ${t.members.map((m) => `\`${m}\``).join(", ")}`,
      t.channelId ? `Channel: <#${t.channelId}>` : "",
    ].filter(Boolean).join("\n"),
    inline: false,
  }));

  await patch(appId, token, {
    embeds: [{
      title: `👥 Teams (${teams.length})`,
      color: 0x3498db,
      fields,
      footer: { text: "GitLab Changelog Bot" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─── /changelog team delete ────────────────────────────────────────────────────

async function handleTeamDelete(
  appId: string, token: string,
  opts: DiscordCommandOption[], env: Env
): Promise<void> {
  const name = getOpt(opts, "name");
  if (!name) {
    await patch(appId, token, buildErrorEmbed("Missing field", "Provide the team `name` to delete."));
    return;
  }
  const deleted = await deleteTeam(env.USERS_KV, name);
  if (!deleted) {
    await patch(appId, token, buildErrorEmbed("Not found", `Team \`${name}\` doesn't exist.`));
    return;
  }
  await patch(appId, token, { content: `✅ Team \`${name}\` deleted.` });
}

// ─── /changelog team add-member ───────────────────────────────────────────────

async function handleTeamAddMember(
  appId: string, token: string,
  opts: DiscordCommandOption[], env: Env
): Promise<void> {
  const name    = getOpt(opts, "name");
  const member  = getOpt(opts, "member");
  if (!name || !member) {
    await patch(appId, token, buildErrorEmbed("Missing field", "Provide both `name` and `member`."));
    return;
  }
  const team = await getTeam(env.USERS_KV, name);
  if (!team) {
    await patch(appId, token, buildErrorEmbed("Not found", `Team \`${name}\` doesn't exist.`));
    return;
  }
  if (!team.members.includes(member)) {
    team.members.push(member);
    await upsertTeam(env.USERS_KV, team.name, team.members, team.channelId);
  }
  await patch(appId, token, { content: `✅ \`${member}\` added to team \`${name}\`.` });
}

// ─── /changelog team remove-member ────────────────────────────────────────────

async function handleTeamRemoveMember(
  appId: string, token: string,
  opts: DiscordCommandOption[], env: Env
): Promise<void> {
  const name   = getOpt(opts, "name");
  const member = getOpt(opts, "member");
  if (!name || !member) {
    await patch(appId, token, buildErrorEmbed("Missing field", "Provide both `name` and `member`."));
    return;
  }
  const team = await getTeam(env.USERS_KV, name);
  if (!team) {
    await patch(appId, token, buildErrorEmbed("Not found", `Team \`${name}\` doesn't exist.`));
    return;
  }
  team.members = team.members.filter((m) => m !== member);
  await upsertTeam(env.USERS_KV, team.name, team.members, team.channelId);
  await patch(appId, token, { content: `✅ \`${member}\` removed from team \`${name}\`.` });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleTeam(
  subName: string,
  opts: DiscordCommandOption[],
  appId: string,
  token: string,
  env: Env
): Promise<void> {
  switch (subName) {
    case "create":        return handleTeamCreate(appId, token, opts, env);
    case "list":          return handleTeamList(appId, token, env);
    case "delete":        return handleTeamDelete(appId, token, opts, env);
    case "add-member":    return handleTeamAddMember(appId, token, opts, env);
    case "remove-member": return handleTeamRemoveMember(appId, token, opts, env);
    default:
      await patch(appId, token, { content: `❓ Unknown team subcommand: \`${subName}\`` });
  }
}
