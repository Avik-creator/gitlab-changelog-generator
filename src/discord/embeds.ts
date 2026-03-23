import type { ChangelogData, DigestMode, GitLabStaleMR, EnrichedMR, UserStats, ReleaseData } from "../types";

const COLORS: Record<string, number> = {
  changelog: 0x2ecc71, pr: 0x3498db, "press-release": 0x9b59b6,
  "release-notes": 0xe67e22, concise: 0x1abc9c, manager: 0xf1c40f,
  engineering: 0x2c3e50, executive: 0x8e44ad,
  empty: 0x95a5a6, health: 0x27ae60, error: 0xe74c3c, stats: 0x3498db,
};

const FORMAT_ICONS: Record<string, string> = {
  changelog: "✨", pr: "🔧", "press-release": "📣", "release-notes": "📝",
  concise: "⚡", manager: "📊", engineering: "🏗️", executive: "🎯",
};

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function mrLine(mr: EnrichedMR): string {
  const diff = mr.diffStats ? ` \`+${mr.diffStats.additions}/-${mr.diffStats.deletions}\`` : "";
  const labels = mr.labels.length ? ` · ${mr.labels.slice(0, 3).join(", ")}` : "";
  const milestone = mr.milestone ? ` 🏁 ${mr.milestone.title}` : "";
  return `• [${truncate(mr.title, 55)}](${mr.web_url})${diff}${labels}${milestone}`;
}

function staleLine(mr: GitLabStaleMR): string {
  return `• [${truncate(mr.title, 50)}](${mr.web_url}) — **${mr.staleDays}d** ${mr.reason} · \`${mr.projectName}\``;
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

export function buildChangelogEmbed(data: ChangelogData): object {
  const { format, mergedMRs, staleMRs, openMRs, filteredOutCount, reviewActivity } = data;
  const hasActivity = mergedMRs.length > 0;
  const color = hasActivity ? (COLORS[format] ?? COLORS.changelog) : COLORS.empty;
  const icon = FORMAT_ICONS[format] ?? "✨";
  const scopeLabel = data.scope.type === "user"
    ? `${data.displayName}'s`
    : `${data.displayName}`;

  const fields: object[] = [];

  // AI summary
  if (data.aiSummary) {
    fields.push({ name: `${icon} ${format.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}`, value: truncate(data.aiSummary, 1024), inline: false });
  }

  // MRs grouped by project
  if (hasActivity) {
    const grouped = groupByProject(mergedMRs);
    let totalAdds = 0, totalDels = 0;

    for (const [projectName, mrs] of grouped) {
      fields.push({
        name: `📦 ${projectName} (${mrs.length})`,
        value: truncate(mrs.map(mrLine).join("\n"), 1024),
        inline: false,
      });
      for (const mr of mrs) {
        if (mr.diffStats) { totalAdds += mr.diffStats.additions; totalDels += mr.diffStats.deletions; }
      }
    }

    // Stats bar
    const stats = [`**${mergedMRs.length}** MRs merged`];
    if (totalAdds + totalDels > 0) stats.push(`\`+${totalAdds}/-${totalDels}\``);
    if (grouped.size > 1) stats.push(`**${grouped.size}** projects`);
    if (filteredOutCount > 0) stats.push(`${filteredOutCount} filtered out`);

    const labelCounts = new Map<string, number>();
    for (const mr of mergedMRs) for (const l of mr.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
    if (topLabels.length) stats.push(topLabels.join(", "));

    fields.push({ name: "📊 Stats", value: stats.join(" · "), inline: false });
  }

  // Review activity
  if (reviewActivity && reviewActivity.reviewsGiven > 0) {
    const parts = [`${reviewActivity.reviewsGiven} reviews`];
    if (reviewActivity.approvals > 0) parts.push(`${reviewActivity.approvals} approvals`);
    if (reviewActivity.commentsLeft > 0) parts.push(`${reviewActivity.commentsLeft} comments`);
    if (reviewActivity.discussionsResolved > 0) parts.push(`${reviewActivity.discussionsResolved} resolved`);
    fields.push({ name: "🔍 Review Activity", value: parts.join(" · "), inline: false });
  }

  // Open / in-progress MRs
  if (openMRs.length > 0) {
    const lines = openMRs.slice(0, 5).map((mr) =>
      `• [${truncate(mr.title, 55)}](${mr.web_url}) · \`${mr.projectName}\``
    ).join("\n");
    fields.push({ name: `🔄 In Progress (${openMRs.length})`, value: truncate(lines, 1024), inline: false });
  }

  // Stale / blocked
  if (staleMRs.length > 0) {
    const lines = staleMRs.slice(0, 5).map(staleLine).join("\n");
    const extra = staleMRs.length > 5 ? `\n_+${staleMRs.length - 5} more_` : "";
    fields.push({ name: `⚠️ Blockers (${staleMRs.length})`, value: truncate(lines + extra, 1024), inline: false });
  }

  return {
    embeds: [{
      title: `📋 ${scopeLabel} Changelog`,
      description: hasActivity ? null : `_No activity found for ${data.dateRange.label}._`,
      color,
      fields,
      footer: { text: `${data.weekISO || data.dateRange.label} · ${data.inputQuality} quality · GitLab Changelog Bot` },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Stats embed ──────────────────────────────────────────────────────────────

export function buildStatsEmbed(stats: UserStats, dateLabel: string): object {
  const fields = [
    { name: "📊 MRs Merged", value: String(stats.mrsMerged), inline: true },
    { name: "📝 Lines Changed", value: `+${stats.totalAdditions}/-${stats.totalDeletions}`, inline: true },
    { name: "📦 Repos", value: stats.reposContributed.join(", ") || "None", inline: true },
    { name: "⏱️ Avg Time to Merge", value: `${stats.avgTimeToMerge}h`, inline: true },
    { name: "🔍 Reviews Given", value: String(stats.reviewActivity.reviewsGiven), inline: true },
    { name: "✅ Approvals", value: String(stats.reviewActivity.approvals), inline: true },
    { name: "💬 Comments", value: String(stats.reviewActivity.commentsLeft), inline: true },
    { name: "🔓 Discussions Resolved", value: String(stats.reviewActivity.discussionsResolved), inline: true },
  ];

  const topLabels = Object.entries(stats.labelsUsed).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topLabels.length) {
    fields.push({ name: "🏷️ Top Labels", value: topLabels.map(([l, c]) => `${l} (${c})`).join(", "), inline: false });
  }

  return {
    embeds: [{
      title: `📈 ${stats.displayName}'s Stats`,
      color: COLORS.stats,
      fields,
      footer: { text: dateLabel },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Release embed ────────────────────────────────────────────────────────────

export function buildReleaseEmbed(release: ReleaseData): object {
  const fields: object[] = [];
  if (release.aiSummary) fields.push({ name: "📝 Summary", value: truncate(release.aiSummary, 1024), inline: false });

  const sections = [
    { name: "🚀 Features", mrs: release.features },
    { name: "🐛 Bug Fixes", mrs: release.fixes },
    { name: "🔧 Improvements", mrs: release.improvements },
    { name: "💥 Breaking Changes", mrs: release.breaking },
    { name: "🔩 Internal", mrs: release.internal },
  ];

  for (const { name, mrs } of sections) {
    if (mrs.length === 0) continue;
    fields.push({
      name: `${name} (${mrs.length})`,
      value: truncate(mrs.map(mrLine).join("\n"), 1024),
      inline: false,
    });
  }

  const total = release.features.length + release.fixes.length + release.improvements.length + release.breaking.length + release.internal.length;
  fields.push({ name: "📊 Total", value: `${total} changes`, inline: false });

  return {
    embeds: [{
      title: `📦 Release: ${release.label}`,
      color: COLORS["release-notes"],
      fields,
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Config embed ─────────────────────────────────────────────────────────────

export function buildConfigEmbed(title: string, config: Record<string, unknown>): object {
  const fields = Object.entries(config).map(([key, val]) => ({
    name: key,
    value: `\`${typeof val === "object" ? JSON.stringify(val) : String(val)}\``,
    inline: true,
  }));
  return { embeds: [{ title: `⚙️ ${title}`, color: 0xf39c12, fields, timestamp: new Date().toISOString() }] };
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
  const linked = mappings.map((m) => `• <@${m.discordId}> → \`${m.gitlabUsername}\``).join("\n");
  const unlinked = groupMembers.filter((g) => !mappedUsernames.has(g.username))
    .map((g) => `• \`${g.username}\` (${g.name})`).join("\n");

  const fields = [];
  if (linked) fields.push({ name: `🔗 Linked (${mappings.length})`, value: truncate(linked, 1024), inline: false });
  if (unlinked) fields.push({ name: `🦊 GitLab-only`, value: truncate(unlinked, 1024), inline: false });

  return {
    embeds: [{
      title: "👥 Team Members",
      description: fields.length === 0 ? "_No members found._" : null,
      color: COLORS.health,
      fields,
      footer: { text: `${groupMembers.length} GitLab · ${mappings.length} linked` },
    }],
  };
}

export function buildHealthEmbed(stats: {
  mappingCount: number; gitlabMemberCount: number; gitlabOk: boolean; aiOk: boolean;
  configuredFilters: string[];
}): object {
  const fields = [
    { name: "🦊 GitLab members", value: String(stats.gitlabMemberCount), inline: true },
    { name: "🔗 Discord-linked", value: String(stats.mappingCount), inline: true },
    { name: "🦊 GitLab API", value: stats.gitlabOk ? "✅ OK" : "❌ Error", inline: true },
    { name: "🤖 Workers AI", value: stats.aiOk ? "✅ OK" : "❌ Error", inline: true },
  ];
  if (stats.configuredFilters.length > 0) {
    fields.push({ name: "🔧 Active filters", value: stats.configuredFilters.join(", "), inline: false });
  }
  return {
    embeds: [{
      title: "🏥 Changelog Bot Health",
      color: stats.gitlabOk && stats.aiOk ? COLORS.health : COLORS.error,
      fields,
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
