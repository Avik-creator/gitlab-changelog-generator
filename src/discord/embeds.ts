import type { ChangelogData, ChangelogFormat, GitLabStaleMR, EnrichedMR } from "../types";
import { formatWeekLabel } from "../utils/weeks";

const COLORS: Record<ChangelogFormat, number> & { empty: number; health: number; error: number } = {
  changelog:       0x2ecc71,
  pr:              0x3498db,
  "press-release": 0x9b59b6,
  "release-notes": 0xe67e22,
  concise:         0x1abc9c,
  empty:           0x95a5a6,
  health:          0x27ae60,
  error:           0xe74c3c,
};

const FORMAT_META: Record<ChangelogFormat, { icon: string; label: string }> = {
  changelog:       { icon: "✨", label: "AI Summary" },
  pr:              { icon: "🔧", label: "PR Release Notes" },
  "press-release": { icon: "📣", label: "Press Release" },
  "release-notes": { icon: "📝", label: "Release Notes" },
  concise:         { icon: "⚡", label: "TL;DR" },
};

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function mrLine(mr: EnrichedMR): string {
  const diff = mr.diffStats ? ` \`+${mr.diffStats.additions}/-${mr.diffStats.deletions}\`` : "";
  const labels = mr.labels.length ? ` · ${mr.labels.slice(0, 3).join(", ")}` : "";
  const milestone = mr.milestone ? ` 🏁 ${mr.milestone.title}` : "";
  return `• [${truncate(mr.title, 60)}](${mr.web_url})${diff}${labels}${milestone}`;
}

function staleLine(mr: GitLabStaleMR): string {
  return `• [${truncate(mr.title, 55)}](${mr.web_url}) — **${mr.staleDays}d** stale · \`${mr.projectName}\``;
}

function groupByProject(mrs: EnrichedMR[]): Map<string, EnrichedMR[]> {
  const map = new Map<string, EnrichedMR[]>();
  for (const mr of mrs) {
    const list = map.get(mr.projectName) ?? [];
    list.push(mr);
    map.set(mr.projectName, list);
  }
  return map;
}

// ─── Main changelog embed ─────────────────────────────────────────────────────

export function buildChangelogEmbed(data: ChangelogData, format: ChangelogFormat = "changelog"): object {
  const meta = FORMAT_META[format];
  const hasActivity = data.mergedMRs.length > 0;
  const color = hasActivity ? COLORS[format] : COLORS.empty;
  const weekLabel = formatWeekLabel({ weekISO: data.weekISO, weekStart: data.weekStart, weekEnd: data.weekEnd });

  const fields: object[] = [];

  if (data.aiSummary) {
    fields.push({ name: `${meta.icon} ${meta.label}`, value: truncate(data.aiSummary, 1024), inline: false });
  }

  if (hasActivity) {
    const grouped = groupByProject(data.mergedMRs);
    let totalAdds = 0, totalDels = 0;

    for (const [projectName, mrs] of grouped) {
      fields.push({
        name: `📦 ${projectName} (${mrs.length} MR${mrs.length > 1 ? "s" : ""})`,
        value: truncate(mrs.map(mrLine).join("\n"), 1024),
        inline: false,
      });
      for (const mr of mrs) {
        if (mr.diffStats) { totalAdds += mr.diffStats.additions; totalDels += mr.diffStats.deletions; }
      }
    }

    const statParts = [`**${data.mergedMRs.length}** MRs merged`];
    if (totalAdds + totalDels > 0) statParts.push(`\`+${totalAdds}/-${totalDels}\` lines`);
    if (grouped.size > 1) statParts.push(`across **${grouped.size}** projects`);

    const labelCounts = new Map<string, number>();
    for (const mr of data.mergedMRs) {
      for (const l of mr.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    }
    const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
    if (topLabels.length) statParts.push(`Labels: ${topLabels.join(", ")}`);

    fields.push({ name: "📊 Stats", value: statParts.join(" · "), inline: false });
  }

  if (data.staleMRs.length > 0) {
    const lines = data.staleMRs.slice(0, 5).map(staleLine).join("\n");
    const extra = data.staleMRs.length > 5 ? `\n_...and ${data.staleMRs.length - 5} more_` : "";
    fields.push({
      name: `⚠️ Stale Open MRs (${data.staleMRs.length})`,
      value: truncate(lines + extra, 1024),
      inline: false,
    });
  }

  return {
    embeds: [{
      title: `📋 ${data.displayName}'s Weekly Changelog`,
      description: hasActivity ? null : `_No activity found for ${weekLabel}._`,
      color,
      fields,
      footer: { text: `${data.weekISO} · ${weekLabel} · GitLab Changelog Bot` },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Utility embeds ───────────────────────────────────────────────────────────

export function buildErrorEmbed(title: string, description: string): object {
  return { embeds: [{ title: `❌ ${title}`, description, color: COLORS.error, timestamp: new Date().toISOString() }] };
}

export function buildSuccessEmbed(title: string, description: string): object {
  return { embeds: [{ title: `✅ ${title}`, description, color: COLORS.health, timestamp: new Date().toISOString() }] };
}

export function buildUserListEmbed(
  mappings: Array<{ discordId: string; discordUsername: string; gitlabUsername: string }>,
  groupMembers: Array<{ username: string; name: string }>
): object {
  const mappedUsernames = new Set(mappings.map((m) => m.gitlabUsername));

  const linkedRows = mappings
    .map((m) => `• <@${m.discordId}> → \`${m.gitlabUsername}\``)
    .join("\n");

  // Show GitLab members who haven't been linked to a Discord account yet
  const unlinked = groupMembers.filter((gm) => !mappedUsernames.has(gm.username));
  const unlinkedRows = unlinked
    .map((gm) => `• \`${gm.username}\` (${gm.name}) — _not linked_`)
    .join("\n");

  const fields = [];
  if (linkedRows) fields.push({ name: `🔗 Linked (${mappings.length})`, value: truncate(linkedRows, 1024), inline: false });
  if (unlinkedRows) fields.push({ name: `🦊 GitLab-only (${unlinked.length})`, value: truncate(unlinkedRows, 1024), inline: false });

  return {
    embeds: [{
      title: "👥 Team Members",
      description: fields.length === 0 ? "_No members found._" : null,
      color: COLORS.health,
      fields,
      footer: { text: `${groupMembers.length} GitLab member(s) · ${mappings.length} Discord-linked` },
    }],
  };
}

export function buildHealthEmbed(stats: {
  mappingCount: number;
  gitlabMemberCount: number;
  gitlabOk: boolean;
  aiOk: boolean;
}): object {
  return {
    embeds: [{
      title: "🏥 Changelog Bot Health",
      color: stats.gitlabOk && stats.aiOk ? COLORS.health : COLORS.error,
      fields: [
        { name: "🦊 GitLab members", value: String(stats.gitlabMemberCount), inline: true },
        { name: "🔗 Discord-linked", value: String(stats.mappingCount), inline: true },
        { name: "🦊 GitLab API", value: stats.gitlabOk ? "✅ OK" : "❌ Error", inline: true },
        { name: "🤖 Workers AI", value: stats.aiOk ? "✅ OK" : "❌ Error", inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
}

export function buildPreviewComponents(jobKey: string): object[] {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "✅ Approve & Post", custom_id: `changelog_approve:${jobKey}` },
      { type: 2, style: 4, label: "🗑️ Discard", custom_id: `changelog_discard:${jobKey}` },
    ],
  }];
}
