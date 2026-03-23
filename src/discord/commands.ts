import type { ChangelogFormat, DiscordCommandOption, Env } from "../types";
import { buildChangelogForUser, getWeekRange } from "../gitlab/changelog";
import { generateAISummary } from "../ai/summarize";
import { getAllUsers, getUser, getUserByGitlab, registerUser } from "../kv/users";
import {
  buildChangelogEmbed,
  buildErrorEmbed,
  buildSuccessEmbed,
  buildUserListEmbed,
} from "./embeds";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Edit the deferred "thinking" message with the final result.
 */
async function editOriginalMessage(
  appId: string,
  token: string,
  botToken: string,
  body: object
): Promise<void> {
  await fetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(body),
  });
}

function getOption(options: DiscordCommandOption[] | undefined, name: string): string | undefined {
  return options?.find((o) => o.name === name)?.value?.toString();
}

function getSubcommand(
  options: DiscordCommandOption[] | undefined
): { name: string; options: DiscordCommandOption[] } | null {
  const sub = options?.find((o) => o.type === 1);
  if (!sub) return null;
  return { name: sub.name, options: sub.options ?? [] };
}

// ---------------------------------------------------------------------------
// Subcommand: generate
// ---------------------------------------------------------------------------
export async function handleGenerate(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env
): Promise<void> {
  const discordUserId = getOption(options, "user");
  const gitlabDirect = getOption(options, "gitlab_username");
  const generateAll = getOption(options, "all") === "true" || options.some((o) => o.name === "all");
  const rawFormat = getOption(options, "format") ?? "changelog";
  const format: ChangelogFormat =
    rawFormat === "pr" || rawFormat === "press-release" ? rawFormat : "changelog";

  const { weekStart, weekEnd } = getWeekRange();

  if (generateAll || (!discordUserId && !gitlabDirect)) {
    // Generate for all registered users
    const users = await getAllUsers(env.USERS_KV);

    if (users.length === 0) {
      await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
        buildErrorEmbed("No users are registered. Use `/changelog register` to add team members."));
      return;
    }

    for (const user of users) {
      try {
        const changelogData = await buildChangelogForUser(user, env, weekStart, weekEnd);
        changelogData.aiSummary = await generateAISummary(env.AI, changelogData, format);
        const embed = buildChangelogEmbed(changelogData, format);

        await fetch(`${DISCORD_API}/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
          body: JSON.stringify(embed),
        });
      } catch (err) {
        console.error(`Failed to generate changelog for ${user.gitlabUsername}:`, err);
      }
    }

    await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
      buildSuccessEmbed(
        "Changelogs Generated",
        `Generated and posted changelogs for **${users.length}** team members.`
      ));
    return;
  }

  // Single user — resolve the UserMapping
  let userMapping = null;

  if (discordUserId) {
    userMapping = await getUser(env.USERS_KV, discordUserId);
    if (!userMapping) {
      await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
        buildErrorEmbed(`<@${discordUserId}> is not registered. Use \`/changelog register\` first.`));
      return;
    }
  } else if (gitlabDirect) {
    userMapping = await getUserByGitlab(env.USERS_KV, gitlabDirect);
    if (!userMapping) {
      // Create a transient mapping for unregistered GitLab users
      userMapping = { discordId: "", discordUsername: gitlabDirect, gitlabUsername: gitlabDirect };
    }
  }

  if (!userMapping) {
    await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
      buildErrorEmbed("Could not resolve user. Provide a Discord @mention or a GitLab username."));
    return;
  }

  try {
    const changelogData = await buildChangelogForUser(userMapping, env, weekStart, weekEnd);
    changelogData.aiSummary = await generateAISummary(env.AI, changelogData, format);
    await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN, buildChangelogEmbed(changelogData, format));
  } catch (err) {
    console.error("Changelog generation error:", err);
    await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
      buildErrorEmbed(`Failed to generate changelog: ${err instanceof Error ? err.message : "Unknown error"}`));
  }
}

// ---------------------------------------------------------------------------
// Subcommand: register
// ---------------------------------------------------------------------------
export async function handleRegister(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env
): Promise<void> {
  const discordUserId = getOption(options, "discord_user");
  const gitlabUsername = getOption(options, "gitlab_username");
  const discordUsername = getOption(options, "discord_username") ?? discordUserId ?? "Unknown";

  if (!discordUserId || !gitlabUsername) {
    await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
      buildErrorEmbed("Both `discord_user` and `gitlab_username` are required."));
    return;
  }

  await registerUser(env.USERS_KV, discordUserId, discordUsername, gitlabUsername);

  await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN,
    buildSuccessEmbed(
      "User Registered",
      `<@${discordUserId}> has been linked to GitLab user \`${gitlabUsername}\`.`
    ));
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------
export async function handleList(
  appId: string,
  token: string,
  env: Env
): Promise<void> {
  const users = await getAllUsers(env.USERS_KV);
  await editOriginalMessage(appId, token, env.DISCORD_BOT_TOKEN, buildUserListEmbed(users));
}

// ---------------------------------------------------------------------------
// Main command router
// ---------------------------------------------------------------------------
export async function routeCommand(
  appId: string,
  interactionToken: string,
  commandOptions: DiscordCommandOption[] | undefined,
  env: Env
): Promise<void> {
  const sub = getSubcommand(commandOptions);

  if (!sub) {
    await editOriginalMessage(appId, interactionToken, env.DISCORD_BOT_TOKEN,
      buildErrorEmbed("Unknown subcommand. Use `/changelog generate`, `/changelog register`, or `/changelog list`."));
    return;
  }

  switch (sub.name) {
    case "generate":
      await handleGenerate(appId, interactionToken, sub.options, env);
      break;
    case "register":
      await handleRegister(appId, interactionToken, sub.options, env);
      break;
    case "list":
      await handleList(appId, interactionToken, env);
      break;
    default:
      await editOriginalMessage(appId, interactionToken, env.DISCORD_BOT_TOKEN,
        buildErrorEmbed(`Unknown subcommand: \`${sub.name}\``));
  }
}
