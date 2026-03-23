import type { Env, DiscordCommandOption } from "../../types";
import { GitLabClient } from "../../gitlab/client";
import { getGitlabUsername, getAllMappings } from "../../kv/users";
import { getRunRecord } from "../../kv/run-history";
import { parseDateRange } from "../../utils/weeks";
import { buildChangelogForUser } from "../../gitlab/changelog";
import { buildChangelogEmbed, buildErrorEmbed } from "../embeds";
import { getGlobalConfig, resolveFilters } from "../../kv/config";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

// ─── /changelog last-run ──────────────────────────────────────────────────────

export async function handleLastRun(appId: string, token: string, env: Env): Promise<void> {
  const record = await getRunRecord(env.USERS_KV);
  if (!record) {
    await patch(appId, token, { content: "⚠️ No weekly run recorded yet. The cron hasn't fired or no data was saved." });
    return;
  }

  const ts = new Date(record.triggeredAt).toLocaleString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });

  const statusLine = record.failed > 0
    ? `⚠️ ${record.posted} posted, ${record.failed} failed, ${record.skipped} skipped`
    : `✅ ${record.posted} posted, ${record.skipped} skipped`;

  const errorBlock = record.errors.length > 0
    ? `\n\n**Errors:**\n${record.errors.slice(0, 5).map((e) => `• ${e}`).join("\n")}`
    : "";

  await patch(appId, token, {
    embeds: [{
      title: "🕐 Last Weekly Run",
      color: record.failed > 0 ? 0xe67e22 : 0x27ae60,
      fields: [
        { name: "Triggered At", value: `\`${ts}\``, inline: true },
        { name: "Trigger", value: record.triggerType, inline: true },
        { name: "Duration", value: `${(record.durationMs / 1000).toFixed(1)}s`, inline: true },
        { name: "Members Processed", value: String(record.membersProcessed), inline: true },
        { name: "Results", value: statusLine, inline: false },
      ],
      description: errorBlock || null,
      footer: { text: "GitLab Changelog Bot" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─── /changelog sync-users ────────────────────────────────────────────────────

export async function handleSyncUsers(appId: string, token: string, env: Env): Promise<void> {
  try {
    const client   = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    const members  = await client.getGroupMembers(env.GITLAB_GROUP_ID);
    const mappings = await getAllMappings(env.USERS_KV);

    const linkedGitlab = new Set(mappings.map((m) => m.gitlabUsername));
    const unlinked = members.filter((m) => !linkedGitlab.has(m.username));
    const linked   = members.filter((m) => linkedGitlab.has(m.username));

    const lines: string[] = [];
    if (linked.length > 0) {
      lines.push(`**✅ Linked (${linked.length}):**`);
      for (const m of linked) lines.push(`• \`${m.username}\` — ${m.name}`);
    }
    if (unlinked.length > 0) {
      lines.push(`\n**⚠️ Not linked (${unlinked.length}):**`);
      for (const m of unlinked) {
        lines.push(`• \`${m.username}\` — ${m.name} _(use \`/changelog link gitlab:${m.username}\`)_`);
      }
    }
    if (lines.length === 0) {
      lines.push("No active members found in the GitLab group.");
    }

    const text = lines.join("\n");
    await patch(appId, token, {
      embeds: [{
        title: "🔄 User Sync Report",
        description: text.slice(0, 4096),
        color: unlinked.length > 0 ? 0xe67e22 : 0x27ae60,
        footer: { text: `${members.length} total members · GitLab Changelog Bot` },
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Sync failed", String(err)));
  }
}

// ─── /changelog dry-run ───────────────────────────────────────────────────────

export async function handleDryRun(
  appId: string, token: string,
  options: DiscordCommandOption[], env: Env, userId: string
): Promise<void> {
  const gitlabOpt = getOpt(options, "gitlab");
  const weekOpt   = getOpt(options, "week");

  let gitlabUsername: string;
  if (gitlabOpt) {
    gitlabUsername = gitlabOpt.replace(/^gitlab:/i, "").trim();
  } else {
    const mapped = await getGitlabUsername(env.USERS_KV, userId);
    if (!mapped) {
      await patch(appId, token, buildErrorEmbed("Not linked", "Pass `gitlab:username` or link your account first."));
      return;
    }
    gitlabUsername = mapped;
  }

  try {
    const globalConfig = await getGlobalConfig(env.USERS_KV);
    const filters      = resolveFilters(globalConfig);
    const dateRange    = parseDateRange({ week: weekOpt });
    const data         = await buildChangelogForUser(gitlabUsername, gitlabUsername, env, dateRange, "changelog", filters);

    const embed = buildChangelogEmbed(data) as Record<string, unknown>;
    await patch(appId, token, {
      ...embed,
      content: `🔍 **Dry-run preview** for \`${gitlabUsername}\` — ${dateRange.label}.\n_Nothing will be posted._`,
      flags: 64,
    });
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Dry-run failed", String(err)));
  }
}

// ─── /changelog test-post ─────────────────────────────────────────────────────

export async function handleTestPost(appId: string, token: string, env: Env): Promise<void> {
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANGELOG_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🧪 Test Post",
          description: "This is a test message from GitLab Changelog Bot. If you see this, the bot can post to this channel. ✅",
          color: 0x27ae60,
          footer: { text: "GitLab Changelog Bot" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (res.ok) {
      await patch(appId, token, { content: `✅ Test message posted to <#${env.DISCORD_CHANGELOG_CHANNEL_ID}>` });
    } else {
      const body = await res.text();
      await patch(appId, token, buildErrorEmbed("Post failed", `HTTP ${res.status}: ${body.slice(0, 300)}`));
    }
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Test post error", String(err)));
  }
}

// ─── Router ────────────────────────────────────────────────────────────────────

export async function handleAdmin(
  subName: string,
  opts: DiscordCommandOption[],
  appId: string,
  token: string,
  env: Env,
  userId: string
): Promise<void> {
  switch (subName) {
    case "last-run":   return handleLastRun(appId, token, env);
    case "sync-users": return handleSyncUsers(appId, token, env);
    case "dry-run":    return handleDryRun(appId, token, opts, env, userId);
    case "test-post":  return handleTestPost(appId, token, env);
    default:
      await patch(appId, token, { content: `❓ Unknown admin subcommand: \`${subName}\`` });
  }
}
