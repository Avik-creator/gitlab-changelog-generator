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

/**
 * Split MRs into embed fields that are GUARANTEED to stay within 1024 chars.
 *
 * The old fixed-chunk approach (every 10 MRs) caused `safeEmbed()` to truncate
 * mid-line, cutting Discord markdown links like `[title](` without the `)` and
 * making them render as plain text. This version adds MR lines one-by-one and
 * starts a new field the moment the next line would push over the limit.
 */
function mrFields(projectName: string, mrs: EnrichedMR[], totalInScope?: number): EmbedField[] {
  const MAX_VALUE = 950; // Discord hard limit is 1024; keep a safe margin
  const fields: EmbedField[] = [];
  let lines: string[] = [];
  let charLen = 0;
  let startIdx = 0;

  const flush = (endIdx: number) => {
    if (lines.length === 0) return;
    const total = totalInScope ?? mrs.length;
    const rangeStr = total > lines.length
      ? ` (${startIdx + 1}–${endIdx} of ${total})`
      : ` (${total})`;
    const name = fields.length === 0
      ? `📦 ${projectName}${rangeStr}`
      : `📦 ${projectName} ${rangeStr}`;
    fields.push({ name: name.slice(0, 256), value: lines.join("\n"), inline: false });
    startIdx = endIdx;
    lines   = [];
    charLen = 0;
  };

  for (let i = 0; i < mrs.length; i++) {
    const line    = mrLine(mrs[i]!);
    const addCost = charLen === 0 ? line.length : line.length + 1; // +1 for the "\n"
    if (addCost + charLen > MAX_VALUE && lines.length > 0) flush(i);
    lines.push(line);
    charLen += addCost;
  }
  flush(mrs.length);

  return fields;
}

export const MR_PAGE_SIZE = 15; // MRs shown per paginated page

/** Discord action-row with Previous / Page-counter / Next buttons. */
export function buildMRPageButtons(
  jobKey: string,
  currentPage: number,
  totalPages: number
): object[] {
  if (totalPages <= 1) return [];
  return [{
    type: 1,
    components: [
      {
        type: 2, style: 2,
        custom_id: `mrpage_go:${jobKey}:${currentPage - 1}`,
        label: "◀ Prev",
        disabled: currentPage === 0,
      },
      {
        type: 2, style: 2,
        custom_id: `__noop__:${jobKey}`,
        label: `Page ${currentPage + 1} / ${totalPages}`,
        disabled: true,
      },
      {
        type: 2, style: 1,
        custom_id: `mrpage_go:${jobKey}:${currentPage + 1}`,
        label: "Next ▶",
        disabled: currentPage >= totalPages - 1,
      },
    ],
  }];
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

// ─── Discord embed safety ─────────────────────────────────────────────────────

const EMBED_FIELD_MAX  = 1024;
const EMBED_TOTAL_MAX  = 5800; // Discord hard limit is 6000; keep a 200-char buffer
const EMBED_FIELDS_MAX = 25;   // Discord hard limit

type EmbedField = { name: string; value: string; inline: boolean };

/**
 * Strip any fields with blank name/value, cap at 25 fields, and ensure
 * the total character count (title + description + all field names + values + footer)
 * stays under Discord's 6000-char limit. Surplus fields are replaced with a
 * single "… N more fields" notice so no content silently disappears.
 */
function safeEmbed(embed: {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}): object {
  // Sanitise fields: drop empty, truncate values to field max
  const raw = (embed.fields ?? []).filter(
    (f) => f.name?.trim() && f.value?.trim()
  ).map((f) => ({
    ...f,
    name:  f.name.slice(0, 256),
    value: f.value.slice(0, EMBED_FIELD_MAX),
  }));

  // Count chars used by non-field parts
  let used = (embed.title?.length ?? 0)
    + (embed.description?.length ?? 0)
    + (embed.footer?.text?.length ?? 0);

  // Greedily admit fields until we'd breach the total or hit the 25-field cap
  const admitted: EmbedField[] = [];
  for (const f of raw) {
    if (admitted.length >= EMBED_FIELDS_MAX) break;
    const cost = f.name.length + f.value.length;
    if (used + cost > EMBED_TOTAL_MAX) {
      const remaining = raw.length - admitted.length;
      admitted.push({
        name:   "ℹ️ Truncated",
        value:  `_${remaining} more field(s) omitted — embed character limit reached._`,
        inline: false,
      });
      break;
    }
    used += cost;
    admitted.push(f);
  }

  return {
    embeds: [{
      ...(embed.title       ? { title:       embed.title }       : {}),
      ...(embed.description ? { description: embed.description } : {}),
      ...(embed.color       !== undefined ? { color: embed.color } : {}),
      fields: admitted,
      ...(embed.footer    ? { footer:    embed.footer }    : {}),
      ...(embed.timestamp ? { timestamp: embed.timestamp } : {}),
    }],
  };
}

// ─── Main changelog embed ─────────────────────────────────────────────────────

export interface BuildChangelogOpts {
  /** Zero-based page index for MR pagination (default 0). */
  page?:       number;
  /** KV job key — required to enable pagination buttons. */
  jobKey?:     string;
  /** Total number of pages — required to enable pagination buttons. */
  totalPages?: number;
}

export function buildChangelogEmbed(data: ChangelogData, opts: BuildChangelogOpts = {}): object {
  const { format, mergedMRs, staleMRs, openMRs, filteredOutCount, reviewActivity } = data;
  const page       = opts.page ?? 0;
  const jobKey     = opts.jobKey;
  const totalPages = opts.totalPages ?? (mergedMRs.length > MR_PAGE_SIZE ? Math.ceil(mergedMRs.length / MR_PAGE_SIZE) : 1);

  // Slice MRs for the current page
  const pageMRs    = mergedMRs.slice(page * MR_PAGE_SIZE, (page + 1) * MR_PAGE_SIZE);
  const hasActivity = mergedMRs.length > 0;
  const color       = hasActivity ? (COLORS[format] ?? COLORS.changelog) : COLORS.empty;
  const icon        = FORMAT_ICONS[format] ?? "✨";
  const scopeLabel  = data.scope.type === "user"
    ? `${data.displayName}'s`
    : `${data.displayName}`;

  const pageLabel   = totalPages > 1 ? ` · Page ${page + 1}/${totalPages}` : "";

  const fields: EmbedField[] = [];

  // AI summary — only on first page so it doesn't repeat
  if (page === 0 && data.aiSummary?.trim()) {
    fields.push({
      name:   `${icon} ${format.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
      value:  truncate(data.aiSummary, EMBED_FIELD_MAX),
      inline: false,
    });
  }

  // MRs for this page, grouped by project, character-aware (no broken links)
  if (hasActivity) {
    const grouped    = groupByProject(pageMRs);
    let   totalFiles = 0;

    for (const [projectName, mrs] of grouped) {
      // Pass the total count for this project so the "(X–Y of Z)" range is correct
      const totalForProject = mergedMRs.filter((m) => m.projectName === projectName).length;
      const projectPageOffset = page * MR_PAGE_SIZE;
      // Only show the subset that belongs to this page (already filtered via pageMRs above)
      for (const f of mrFields(projectName, mrs, totalForProject > MR_PAGE_SIZE ? totalForProject : undefined)) {
        fields.push(f);
      }
      for (const mr of mrs) {
        if (mr.diffStats) totalFiles += mr.diffStats.additions;
      }
    }

    // Stats bar — only on first page
    if (page === 0) {
      const stats = [`**${mergedMRs.length}** MRs merged`];
      if (totalFiles > 0) stats.push(`**${totalFiles}** files changed`);
      const allGrouped = groupByProject(mergedMRs);
      if (allGrouped.size > 1) stats.push(`**${allGrouped.size}** projects`);
      if (filteredOutCount > 0) stats.push(`${filteredOutCount} filtered out`);

      const labelCounts = new Map<string, number>();
      for (const mr of mergedMRs) for (const l of mr.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
      const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
      if (topLabels.length) stats.push(topLabels.join(", "));

      const statsValue = stats.join(" · ");
      if (statsValue.trim()) fields.push({ name: "📊 Stats", value: statsValue, inline: false });

      if (data.trend) {
        const trendLine = formatTrendLine(data.trend);
        if (trendLine?.trim()) fields.push({ name: "📈 Trend", value: trendLine, inline: false });
      }
    }
  }

  // Non-MR sections — only on first page
  if (page === 0) {
    if (reviewActivity && reviewActivity.reviewsGiven > 0) {
      const parts = [`${reviewActivity.reviewsGiven} reviews`];
      if (reviewActivity.approvals > 0)          parts.push(`${reviewActivity.approvals} approvals`);
      if (reviewActivity.commentsLeft > 0)        parts.push(`${reviewActivity.commentsLeft} comments`);
      if (reviewActivity.discussionsResolved > 0) parts.push(`${reviewActivity.discussionsResolved} resolved`);
      fields.push({ name: "🔍 Review Activity", value: parts.join(" · "), inline: false });
    }

    if (openMRs.length > 0) {
      const lines = openMRs.slice(0, 5)
        .map((mr) => `• [${truncate(mr.title, 55)}](${mr.web_url}) · \`${mr.projectName}\``)
        .join("\n");
      if (lines.trim()) fields.push({ name: `🔄 In Progress (${openMRs.length})`, value: truncate(lines, EMBED_FIELD_MAX), inline: false });
    }

    if (staleMRs.length > 0) {
      const lines = staleMRs.slice(0, 5).map(staleLine).join("\n");
      const extra = staleMRs.length > 5 ? `\n_+${staleMRs.length - 5} more_` : "";
      const val   = (lines + extra).trim();
      if (val) fields.push({ name: `⚠️ Blockers (${staleMRs.length})`, value: truncate(val, EMBED_FIELD_MAX), inline: false });
    }
  }

  const footerText = `${data.weekISO || data.dateRange.label} · ${data.inputQuality} quality · GitLab Changelog Bot`;

  const baseEmbed = safeEmbed({
    title:       `📋 ${scopeLabel} Changelog${pageLabel}`,
    description: hasActivity ? undefined : `_No activity found for ${data.dateRange.label}._`,
    color,
    fields,
    footer:      { text: footerText },
    timestamp:   new Date().toISOString(),
  });

  // Attach pagination buttons if there are multiple pages and we have a job key
  const pageButtons = jobKey ? buildMRPageButtons(jobKey, page, totalPages) : [];

  return {
    ...(baseEmbed as Record<string, unknown>),
    ...(pageButtons.length > 0 ? { components: pageButtons } : {}),
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
