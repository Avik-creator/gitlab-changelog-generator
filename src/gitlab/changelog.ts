import { GitLabClient } from "./client";
import { applyFilters, assessInputQuality } from "./filters";
import type {
  Env, ChangelogData, DigestMode, FilterConfig, ChangelogScope,
  DateRange, EnrichedMR, UserStats,
} from "../types";
import { parseDateRange } from "../utils/weeks";

/**
 * Build a changelog for a single GitLab user.
 */
export async function buildChangelogForUser(
  gitlabUsername: string,
  displayName: string,
  env: Env,
  dateRange: DateRange,
  format: DigestMode,
  filters: FilterConfig
): Promise<ChangelogData> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  // Open MRs: use raw MRs cast to EnrichedMR (no extra enrichment calls)
  const rawOpenMRs = await client.getOpenMRsByAuthor(env.GITLAB_GROUP_ID, gitlabUsername)
    .catch(() => [] as import("../types").GitLabMR[]);

  const openMRsRaw = rawOpenMRs
    .filter((m) => !m.draft)
    .slice(0, 10)
    .map((mr): import("../types").EnrichedMR => ({
      ...mr,
      projectName: (() => {
        try { const seg = new URL(mr.web_url).pathname.split("/-/").at(0) ?? ""; return seg.split("/").filter(Boolean).at(-1) ?? mr.project_id.toString(); }
        catch { return `Project ${mr.project_id}`; }
      })(),
      projectUrl: "",
      commits: [],
      diffStats: null,
      isRevert: false,
    }));

  const [rawEnriched, staleMRs, reviewActivity] = await Promise.all([
    client.getMergedMRsByAuthor(env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until)
      .then((mrs) => client.enrichMRs(mrs)),
    client.getStaleMRs(env.GITLAB_GROUP_ID, [gitlabUsername]),
    client.getReviewActivity(env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until)
      .catch(() => null),
  ]);

  // Fetch actual line counts — budget: ~10 base calls + N diff calls, stays under 50
  const rawMRs = await client.enrichDiffStats(rawEnriched, 35);

  const { passed: mergedMRs, filteredOut } = applyFilters(rawMRs, filters);
  const inputQuality = assessInputQuality(mergedMRs);

  return {
    gitlabUsername,
    displayName,
    scope: { type: "user", value: gitlabUsername },
    dateRange,
    mergedMRs,
    filteredOutCount: filteredOut,
    staleMRs,
    openMRs: openMRsRaw,
    reviewActivity,
    aiSummary: "",
    format,
    inputQuality,
    weekISO: dateRange.isoWeek ?? "",
    weekStart: dateRange.since,
    weekEnd: dateRange.until,
  };
}

/**
 * Build changelogs for all group members (weekly cron / all:true).
 */
export async function buildChangelogsForGroup(
  groupId: string,
  env: Env,
  dateRange: DateRange,
  format: DigestMode,
  filters: FilterConfig
): Promise<ChangelogData[]> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
  const members = await client.getGroupMembers(groupId, true);

  return Promise.all(
    members.map((m) =>
      buildChangelogForUser(m.username, m.name, env, dateRange, format, filters)
    )
  );
}

/**
 * Build a project-scoped changelog (all authors in one project).
 */
export async function buildChangelogForProject(
  projectPathOrId: string,
  env: Env,
  dateRange: DateRange,
  format: DigestMode,
  filters: FilterConfig
): Promise<ChangelogData> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
  const project = await client.findProjectByPath(projectPathOrId);
  if (!project) throw new Error(`Project not found: ${projectPathOrId}`);

  const rawMRs = await client.getMergedMRsForProject(project.id, dateRange.since, dateRange.until);
  const enriched = await client.enrichMRs(rawMRs);
  // Fetch actual line counts — project scope has low base call count so budget is plentiful
  const withDiffs = await client.enrichDiffStats(enriched, 40);
  const { passed: mergedMRs, filteredOut } = applyFilters(withDiffs, filters);
  const inputQuality = assessInputQuality(mergedMRs);

  return {
    gitlabUsername: "",
    displayName: project.name,
    scope: { type: "project", value: project.path_with_namespace },
    dateRange,
    mergedMRs,
    filteredOutCount: filteredOut,
    staleMRs: [],   // not fetched for project scope — would multiply subrequests per author
    openMRs: [],
    reviewActivity: null,
    aiSummary: "",
    format,
    inputQuality,
    weekISO: dateRange.isoWeek ?? "",
    weekStart: dateRange.since,
    weekEnd: dateRange.until,
  };
}

/**
 * Build a label-scoped changelog.
 */
export async function buildChangelogForLabel(
  label: string,
  env: Env,
  dateRange: DateRange,
  format: DigestMode,
  filters: FilterConfig
): Promise<ChangelogData> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
  const rawMRs = await client.getMergedMRsByLabel(env.GITLAB_GROUP_ID, label, dateRange.since, dateRange.until);
  const enriched = await client.enrichMRs(rawMRs);
  const { passed: mergedMRs, filteredOut } = applyFilters(enriched, filters);

  return {
    gitlabUsername: "",
    displayName: `Label: ${label}`,
    scope: { type: "label", value: label },
    dateRange,
    mergedMRs,
    filteredOutCount: filteredOut,
    staleMRs: [],
    openMRs: [],
    reviewActivity: null,
    aiSummary: "",
    format,
    inputQuality: assessInputQuality(mergedMRs),
    weekISO: dateRange.isoWeek ?? "",
    weekStart: dateRange.since,
    weekEnd: dateRange.until,
  };
}

/**
 * Build a milestone-scoped changelog.
 */
export async function buildChangelogForMilestone(
  milestoneTitle: string,
  env: Env,
  format: DigestMode,
  filters: FilterConfig
): Promise<ChangelogData> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
  const rawMRs = await client.getMergedMRsByMilestone(env.GITLAB_GROUP_ID, milestoneTitle);
  const enriched = await client.enrichMRs(rawMRs);
  const { passed: mergedMRs, filteredOut } = applyFilters(enriched, filters);

  const dates = mergedMRs.map((mr) => new Date(mr.merged_at).getTime());
  const earliest = dates.length ? new Date(Math.min(...dates)) : new Date();
  const latest = dates.length ? new Date(Math.max(...dates)) : new Date();

  return {
    gitlabUsername: "",
    displayName: `Milestone: ${milestoneTitle}`,
    scope: { type: "milestone", value: milestoneTitle },
    dateRange: { since: earliest, until: latest, label: milestoneTitle },
    mergedMRs,
    filteredOutCount: filteredOut,
    staleMRs: [],
    openMRs: [],
    reviewActivity: null,
    aiSummary: "",
    format,
    inputQuality: assessInputQuality(mergedMRs),
    weekISO: "",
    weekStart: earliest,
    weekEnd: latest,
  };
}

/**
 * Lightweight stats — only 2 API calls per user (MR list + review activity).
 * No per-MR enrichment (commits/diffs), so it stays well within the 50-subrequest
 * limit on the Cloudflare Workers free plan.
 *
 * Used by the leaderboard command where many users are fetched simultaneously.
 * Diff line counts are approximated from `changes_count` (files changed),
 * and project names are parsed from the MR web_url.
 */
export async function computeUserStatsLite(
  gitlabUsername: string,
  displayName: string,
  env: Env,
  dateRange: DateRange,
  filters: FilterConfig
): Promise<UserStats> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  const [rawMRs, reviewActivity] = await Promise.all([
    client.getMergedMRsByAuthor(env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until),
    client.getReviewActivity(env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until)
      .catch((): null => null),
  ]);

  // Apply filters against the raw MRs (no enrichment needed for most filters)
  const filteredMRs = rawMRs.filter((mr) => {
    if (!filters.includeDrafts && mr.draft) return false;
    if (filters.excludeLabels.some((l) => mr.labels.includes(l))) return false;
    if (filters.includeLabels.length > 0 && !filters.includeLabels.some((l) => mr.labels.includes(l))) return false;
    return true;
  });

  const reposSet = new Set<string>();
  const labelsMap: Record<string, number> = {};
  let totalMergeHours = 0;
  let totalFilesChanged = 0;

  for (const mr of filteredMRs) {
    // Parse project path from web_url: https://gitlab.com/group/project/-/merge_requests/1
    try {
      const urlPath = new URL(mr.web_url).pathname;
      const projectPath = (urlPath.split("/-/")[0] ?? "").replace(/^\//, "");
      if (projectPath) reposSet.add(projectPath);
    } catch { /* best-effort */ }

    for (const l of mr.labels) labelsMap[l] = (labelsMap[l] ?? 0) + 1;
    const created = new Date(mr.created_at).getTime();
    const merged  = new Date(mr.merged_at).getTime();
    totalMergeHours += (merged - created) / 3600000;
    totalFilesChanged += parseInt(mr.changes_count ?? "0", 10) || 0;
  }

  return {
    username: gitlabUsername,
    displayName,
    mrsMerged: filteredMRs.length,
    totalAdditions: totalFilesChanged,   // proxy: files changed (not lines)
    totalDeletions: 0,
    reposContributed: [...reposSet],
    avgTimeToMerge: filteredMRs.length ? Math.round(totalMergeHours / filteredMRs.length) : 0,
    reviewActivity: reviewActivity ?? {
      username: gitlabUsername, displayName, reviewsGiven: 0,
      approvals: 0, commentsLeft: 0, discussionsResolved: 0, reviewedMRs: [],
    },
    labelsUsed: labelsMap,
  };
}

/**
 * Compute stats for a user over a date range.
 */
export async function computeUserStats(
  gitlabUsername: string,
  displayName: string,
  env: Env,
  dateRange: DateRange,
  filters: FilterConfig
): Promise<UserStats> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
  const rawMRs = await client.getMergedMRsByAuthor(
    env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until
  );
  const enriched = await client.enrichMRs(rawMRs);
  const { passed: mergedMRs } = applyFilters(enriched, filters);
  const reviewActivity = await client.getReviewActivity(
    env.GITLAB_GROUP_ID, gitlabUsername, dateRange.since, dateRange.until
  ).catch((): null => null);

  let totalAdditions = 0, totalDeletions = 0;
  const reposSet = new Set<string>();
  const labelsMap: Record<string, number> = {};
  let totalMergeHours = 0;

  for (const mr of mergedMRs) {
    if (mr.diffStats) { totalAdditions += mr.diffStats.additions; totalDeletions += mr.diffStats.deletions; }
    reposSet.add(mr.projectName);
    for (const l of mr.labels) labelsMap[l] = (labelsMap[l] ?? 0) + 1;
    const created = new Date(mr.created_at).getTime();
    const merged = new Date(mr.merged_at).getTime();
    totalMergeHours += (merged - created) / 3600000;
  }

  return {
    username: gitlabUsername,
    displayName,
    mrsMerged: mergedMRs.length,
    totalAdditions,
    totalDeletions,
    reposContributed: [...reposSet],
    avgTimeToMerge: mergedMRs.length ? Math.round(totalMergeHours / mergedMRs.length) : 0,
    reviewActivity: reviewActivity ?? {
      username: gitlabUsername, displayName, reviewsGiven: 0,
      approvals: 0, commentsLeft: 0, discussionsResolved: 0, reviewedMRs: [],
    },
    labelsUsed: labelsMap,
  };
}
