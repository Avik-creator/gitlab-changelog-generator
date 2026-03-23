import type { Env, DiscordCommandOption } from "../../types";
import { computeUserStats } from "../../gitlab/changelog";
import { buildStatsEmbed, buildErrorEmbed } from "../embeds";
import { getGitlabUsername } from "../../kv/users";
import { getGlobalConfig, getUserConfig, resolveFilters } from "../../kv/config";
import { GitLabClient } from "../../gitlab/client";
import { parseDateRange } from "../../utils/weeks";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export async function handleStats(
  appId: string, token: string, options: DiscordCommandOption[],
  env: Env, requesterId: string
): Promise<void> {
  const userOpt   = getOpt(options, "user");
  const gitlabOpt = getOpt(options, "gitlab");
  const weekOpt   = getOpt(options, "week");
  const rangeOpt  = getOpt(options, "range");

  const globalConfig = await getGlobalConfig(env.USERS_KV);
  const userConfig = await getUserConfig(env.USERS_KV, requesterId);
  const filters = resolveFilters(globalConfig, userConfig);
  const dateRange = parseDateRange({ week: weekOpt, range: rangeOpt });

  try {
    let gitlabUsername: string;
    let displayName: string;

    if (gitlabOpt) {
      gitlabUsername = gitlabOpt.replace(/^gitlab:/i, "").trim();
      displayName = gitlabUsername;
    } else if (userOpt) {
      const cleanId = userOpt.replace(/[<@!>]/g, "").trim();
      const mapped = await getGitlabUsername(env.USERS_KV, cleanId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed("User not linked", `<@${cleanId}> is not linked.`));
        return;
      }
      gitlabUsername = mapped;
      displayName = gitlabUsername;
    } else {
      const mapped = await getGitlabUsername(env.USERS_KV, requesterId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed("Not linked", "Link your GitLab first or pass `gitlab:username`."));
        return;
      }
      gitlabUsername = mapped;
      displayName = gitlabUsername;
    }

    // Enrich display name from GitLab
    try {
      const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
      const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
      const found = members.find((m) => m.username === gitlabUsername);
      if (found) displayName = found.name;
    } catch { /* best-effort */ }

    const stats = await computeUserStats(gitlabUsername, displayName, env, dateRange, filters);
    await patch(appId, token, buildStatsEmbed(stats, dateRange.label));

  } catch (err) {
    console.error("handleStats error:", err);
    await patch(appId, token, buildErrorEmbed("Stats failed", `\`\`\`\n${String(err).slice(0, 400)}\n\`\`\``));
  }
}
