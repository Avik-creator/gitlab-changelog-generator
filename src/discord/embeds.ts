import type { ChangelogData, DigestMode, GitLabStaleMR, EnrichedMR, UserStats, ReleaseData, TrendData } from "../types";
import { formatTrendLine } from "../gitlab/trends";

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
  // If deletions > 0, we have real line counts; otherwise it's the files-changed proxy
  const diff = mr.diffStats
    ? mr.diffStats.deletions > 0
      ? ` \`+${mr.diffStats.additions}/-${mr.diffStats.deletions}\``
      : ` \`${mr.diffStats.additions}f\``
    : "";
  const labels = mr.labels.length ? ` · ${mr.labels.slice(0, 2).join(", ")}` : "";
  const milestone = mr.milestone ? ` 🏁 ${mr.milestone.title}` : "";
  return `• [${truncate(mr.title, 50)}](${mr.web_url})${diff}${labels}${milestone}`;
}

/** Split a list of MRs into multiple embed fields to stay within Discord's 1024-char limit. */
function mrFields(projectName: string, mrs: EnrichedMR[]): object[] {
  const CHUNK = 10;
  const fields: object[] = [];
  for (let i = 0; i < mrs.length; i += CHUNK) {
    const chunk = mrs.slice(i, i + CHUNK);
    const suffix = mrs.length > CHUNK
      ? ` (${i + 1}–${Math.min(i + CHUNK, mrs.length)} of ${mrs.length})`
      : ` (${mrs.length})`;
    const name = i === 0 ? `📦 ${projectName}${suffix}` : `📦 ${projectName} ${suffix}`;
    fields.push({ name, value: chunk.map(mrLine).join("\n"), inline: false });
  }
  return fields;
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

  // MRs grouped by project — paginated across multiple fields to show everything
  if (hasActivity) {
    const grouped = groupByProject(mergedMRs);
    let totalFiles = 0;

    for (const [projectName, mrs] of grouped) {
      for (const f of mrFields(projectName, mrs)) fields.push(f);
      for (const mr of mrs) {
        if (mr.diffStats) totalFiles += mr.diffStats.additions;
      }
    }

    // Stats bar — detect whether we have real line counts or just file counts
    const hasRealLines = mergedMRs.some((mr) => mr.diffStats && mr.diffStats.deletions > 0);
    let totalAdds = 0, totalDels = 0;
    for (const mr of mergedMRs) {
      if (mr.diffStats) { totalAdds += mr.diffStats.additions; totalDels += mr.diffStats.deletions; }
    }

    const stats = [`**${mergedMRs.length}** MRs merged`];
    if (hasRealLines) {
      stats.push(`\`+${totalAdds}/-${totalDels}\` lines`);
    } else if (totalFiles > 0) {
      stats.push(`**${totalFiles}** files changed`);
    }
    if (grouped.size > 1) stats.push(`**${grouped.size}** projects`);
    if (filteredOutCount > 0) stats.push(`${filteredOutCount} filtered out`);

    const labelCounts = new Map<string, number>();
    for (const mr of mergedMRs) for (const l of mr.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
    if (topLabels.length) stats.push(topLabels.join(", "));

    fields.push({ name: "📊 Stats", value: stats.join(" · "), inline: false });

    // Trend / comparison
    if (data.trend) {
      fields.push({ name: "📈 Trend", value: formatTrendLine(data.trend), inline: false });
    }
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

// ─── Thread parent (team overview) embed ─────────────────────────────────────

export function buildThreadParentEmbed(
  changelogs: ChangelogData[],
  periodLabel: string,
  teamName?: string
): object {
  const active = changelogs.filter((d) => d.mergedMRs.length > 0);
  const totalMRs    = active.reduce((s, d) => s + d.mergedMRs.length, 0);
  const totalAdds   = active.reduce((s, d) => s + d.mergedMRs.reduce((a, m) => a + (m.diffStats?.additions ?? 0), 0), 0);
  const totalDels   = active.reduce((s, d) => s + d.mergedMRs.reduce((a, m) => a + (m.diffStats?.deletions ?? 0), 0), 0);

  // Top contributors
  const sorted = [...active].sort((a, b) => b.mergedMRs.length - a.mergedMRs.length).slice(0, 5);
  const topList = sorted.map((d) => `• **${d.displayName}** — ${d.mergedMRs.length} MRs`).join("\n");

  const blockers = changelogs.reduce((s, d) => s + d.staleMRs.length, 0);

  const fields: object[] = [
    { name: "📦 Total MRs", value: String(totalMRs), inline: true },
    { name: "👤 Active Members", value: String(active.length), inline: true },
    { name: "📝 Lines Changed", value: totalAdds + totalDels > 0 ? `+${totalAdds}/-${totalDels}` : "—", inline: true },
  ];
  if (blockers > 0) fields.push({ name: "⚠️ Blockers", value: `${blockers} stale MRs across team`, inline: true });
  if (topList) fields.push({ name: "🏆 Top Contributors", value: topList, inline: false });

  return {
    embeds: [{
      title: `📋 ${teamName ? `${teamName} — ` : ""}Team Changelog`,
      description: `Individual changelogs are in the thread below.\n**Period:** ${periodLabel}`,
      color: 0x2ecc71,
      fields,
      footer: { text: `${changelogs.length} members · ${changelogs.length - active.length} with no activity` },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ─── Leaderboard embed ───────────────────────────────────────────────────────

export type LeaderboardMetric = "mrs" | "lines" | "reviews" | "speed";

export interface LeaderboardEntry {
  rank: number;
  stats: UserStats;
  trend?: TrendData;
}

const MEDAL = ["🥇", "🥈", "🥉"];

export function buildLeaderboardEmbed(
  entries: LeaderboardEntry[],
  metric: LeaderboardMetric,
  periodLabel: string
): object {
  const metricLabels: Record<LeaderboardMetric, string> = {
    mrs:     "Most MRs Merged",
    lines:   "Most Files Changed",   // lite stats use files, not lines
    reviews: "Most Reviews Given",
    speed:   "Fastest to Merge (avg)",
  };

  const rows = entries.slice(0, 10).map((e, i) => {
    const { stats } = e;
    const medal = MEDAL[i] ?? `**${i + 1}.**`;
    let metricVal = "";
    switch (metric) {
      case "mrs":     metricVal = `${stats.mrsMerged} MRs`; break;
      case "lines":   metricVal = `${stats.totalAdditions} files`; break;
      case "reviews": metricVal = `${stats.reviewActivity.reviewsGiven} reviews`; break;
      case "speed":   metricVal = stats.mrsMerged > 0 ? `${stats.avgTimeToMerge}h avg` : "no MRs"; break;
    }
    const trendStr = e.trend ? ` · ${formatTrendLine(e.trend).replace(/^vs .+? · /, "")}` : "";
    return `${medal} **${stats.displayName}** — ${metricVal}${trendStr}`;
  });

  const totalMRs    = entries.reduce((s, e) => s + e.stats.mrsMerged, 0);
  const totalReviews = entries.reduce((s, e) => s + e.stats.reviewActivity.reviewsGiven, 0);

  return {
    embeds: [{
      title: `🏆 Leaderboard — ${metricLabels[metric]}`,
      description: rows.join("\n") || "_No activity found._",
      color: 0xf1c40f,
      fields: [
        { name: "📦 Team Total MRs", value: String(totalMRs), inline: true },
        { name: "🔍 Team Total Reviews", value: String(totalReviews), inline: true },
        { name: "👥 Members Ranked", value: String(entries.length), inline: true },
      ],
      footer: { text: `Period: ${periodLabel} · Sorted by: ${metricLabels[metric]}` },
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
