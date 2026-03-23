/**
 * /changelog link   — map a Discord user to their GitLab username
 * /changelog unlink — remove the mapping
 * /changelog list   — show all mappings + GitLab group members
 */
import type { Env, DiscordCommandOption } from "../../types";
import { registerUser, unregisterUser, getAllMappings } from "../../kv/users";
import { GitLabClient } from "../../gitlab/client";
import { buildUserListEmbed, buildSuccessEmbed, buildErrorEmbed } from "../embeds";

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

export async function handleLink(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env
): Promise<void> {
  const userMention = getOpt(options, "user");
  const gitlabArg   = getOpt(options, "gitlab");

  if (!userMention || !gitlabArg) {
    await patch(appId, token, buildErrorEmbed("Missing arguments", "Usage: `/changelog link user:@someone gitlab:theirusername`"));
    return;
  }

  const discordId      = userMention.replace(/[<@!>]/g, "").trim();
  const gitlabUsername = gitlabArg.replace(/^gitlab:/i, "").trim();

  // Validate the GitLab username exists in the group
  try {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
    const found = members.find((m) => m.username === gitlabUsername);
    if (!found) {
      await patch(appId, token, buildErrorEmbed(
        "GitLab user not found",
        `\`${gitlabUsername}\` is not an active member of the GitLab group. Check the username and try again.`
      ));
      return;
    }

    await registerUser(env.USERS_KV, {
      discordId,
      discordUsername: discordId,
      gitlabUsername,
    });

    await patch(appId, token, buildSuccessEmbed(
      "Account linked",
      `<@${discordId}> → \`${gitlabUsername}\` (${found.name})\n_Now use \`/changelog generate\` to see their changelog._`
    ));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Link failed", String(err)));
  }
}

export async function handleUnlink(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env
): Promise<void> {
  const userMention = getOpt(options, "user");
  if (!userMention) {
    await patch(appId, token, buildErrorEmbed("Missing argument", "Usage: `/changelog unlink user:@someone`"));
    return;
  }

  const discordId = userMention.replace(/[<@!>]/g, "").trim();
  try {
    await unregisterUser(env.USERS_KV, discordId);
    await patch(appId, token, buildSuccessEmbed("Account unlinked", `<@${discordId}> Discord↔GitLab link removed.`));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Unlink failed", String(err)));
  }
}

export async function handleList(
  appId: string,
  token: string,
  env: Env
): Promise<void> {
  try {
    const [mappings, members] = await Promise.all([
      getAllMappings(env.USERS_KV),
      new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN)
        .getGroupMembers(env.GITLAB_GROUP_ID, true)
        .catch(() => []),
    ]);
    await patch(appId, token, buildUserListEmbed(mappings, members));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Fetch failed", String(err)));
  }
}
