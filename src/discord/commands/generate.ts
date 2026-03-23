import type { Env, DiscordCommandOption, ChangelogFormat } from "../../types";
import { buildChangelogForUser, buildChangelogForGroup } from "../../gitlab/changelog";
import { generateAISummary } from "../../ai/summarize";
import { buildChangelogEmbed, buildErrorEmbed, buildPreviewComponents } from "../embeds";
import { getGitlabUsername, getAllMappings } from "../../kv/users";
import { GitLabClient } from "../../gitlab/client";
import { parseWeek } from "../../utils/weeks";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}
function getBool(opts: DiscordCommandOption[], name: string): boolean {
  return (opts.find((o) => o.name === name)?.value as boolean) ?? false;
}
function coerceFormat(raw?: string): ChangelogFormat {
  const valid: ChangelogFormat[] = ["changelog", "pr", "press-release", "release-notes", "concise"];
  return valid.includes(raw as ChangelogFormat) ? (raw as ChangelogFormat) : "changelog";
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postToChannel(channelId: string, body: object, botToken: string): Promise<string> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord post failed: ${res.status}`);
  const msg = await res.json() as { id: string };
  return msg.id;
}

export async function handleGenerate(
  appId: string,
  token: string,
  options: DiscordCommandOption[],
  env: Env,
  requesterId: string
): Promise<void> {
  const userOpt    = getOpt(options, "user");
  const gitlabOpt  = getOpt(options, "gitlab");
  const weekOpt    = getOpt(options, "week") ?? "last";
  const format     = coerceFormat(getOpt(options, "format"));
  const preview    = getBool(options, "preview");
  const allFlag    = getBool(options, "all");

  try {
    // ── All group members (from GitLab, no registry needed) ──────────────────
    if (allFlag) {
      const week = parseWeek(weekOpt);
      const changelogs = await buildChangelogForGroup(env.GITLAB_GROUP_ID, env, week.weekISO, format);

      let posted = 0;
      for (const data of changelogs) {
        data.aiSummary = await generateAISummary(env.AI, data, format);
        await postToChannel(
          env.DISCORD_CHANGELOG_CHANNEL_ID,
          buildChangelogEmbed(data, format),
          env.DISCORD_BOT_TOKEN
        );
        posted++;
      }
      await patch(appId, token, { content: `✅ Posted changelogs for **${posted}** team member(s) — ${week.weekISO}.` });
      return;
    }

    // ── Resolve who we're generating for ─────────────────────────────────────
    let gitlabUsername: string;
    let displayName: string;

    if (gitlabOpt) {
      // Direct gitlab:username — no KV lookup needed at all
      gitlabUsername = gitlabOpt.replace(/^gitlab:/i, "").trim();
      displayName = gitlabUsername;

      // Try to enrich display name from GitLab API
      try {
        const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
        const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
        const found = members.find((m) => m.username === gitlabUsername);
        if (found) displayName = found.name;
      } catch { /* best-effort */ }

    } else if (userOpt) {
      // Discord mention — only KV lookup needed here
      const cleanId = userOpt.replace(/[<@!>]/g, "").trim();
      const mapped = await getGitlabUsername(env.USERS_KV, cleanId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed(
          "User not linked",
          `<@${cleanId}> hasn't linked their GitLab account. Use \`/changelog link\`, or try \`gitlab:their_username\` directly.`
        ));
        return;
      }
      gitlabUsername = mapped;
      displayName = gitlabUsername;

      // Enrich from GitLab
      try {
        const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
        const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
        const found = members.find((m) => m.username === gitlabUsername);
        if (found) displayName = found.name;
      } catch { /* best-effort */ }

    } else {
      // Generating for yourself — look up your own mapping
      const mapped = await getGitlabUsername(env.USERS_KV, requesterId);
      if (!mapped) {
        await patch(appId, token, buildErrorEmbed(
          "You haven't linked your GitLab account",
          "Use `/changelog link` first, or specify `gitlab:your_username`."
        ));
        return;
      }
      gitlabUsername = mapped;
      displayName = gitlabUsername;
    }

    const data = await buildChangelogForUser(gitlabUsername, displayName, env, weekOpt, format);
    data.aiSummary = await generateAISummary(env.AI, data, format);
    const embed = buildChangelogEmbed(data, format);

    if (preview) {
      // Store in KV for approve/discard, show ephemeral
      const jobKey = `${gitlabUsername}_${data.weekISO}`.replace(/[^a-z0-9_]/gi, "_");
      await env.USERS_KV.put(`preview:${jobKey}`, JSON.stringify(data), { expirationTtl: 3600 });
      await patch(appId, token, {
        ...(embed as Record<string, unknown>),
        content: `👀 **Preview** for **${displayName}** (${data.weekISO}). Approve to post.`,
        components: buildPreviewComponents(jobKey),
        flags: 64,
      });
      return;
    }

    await postToChannel(env.DISCORD_CHANGELOG_CHANNEL_ID, embed, env.DISCORD_BOT_TOKEN);
    await patch(appId, token, { content: `✅ Changelog for **${displayName}** posted — ${data.weekISO}.` });

  } catch (err) {
    console.error("handleGenerate error:", err);
    await patch(appId, token, buildErrorEmbed("Generation failed", `\`\`\`\n${String(err).slice(0, 500)}\n\`\`\``));
  }
}
