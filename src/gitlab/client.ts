import type {
  GitLabMember,
  GitLabMR,
  GitLabCommit,
  GitLabProject,
  GitLabStaleMR,
  GitLabNote,
  GitLabTag,
  EnrichedMR,
  ReviewActivity,
} from "../types";

const MAX_PAGES = 10;
const STALE_DAYS = 7;

export class GitLabClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/api/v4${path}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": this.token },
    });
    if (!res.ok) {
      throw new Error(`GitLab API ${res.status}: ${path}`);
    }
    return res.json() as Promise<T>;
  }

  private async paginateAll<T>(path: string, params: Record<string, string> = {}, maxPages = MAX_PAGES): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.fetch<T[]>(path, { ...params, per_page: "100", page: String(page) });
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  // ─── Group members ──────────────────────────────────────────────────────────

  async getGroupMembers(groupId: string, includeSubgroups = true): Promise<GitLabMember[]> {
    const path = includeSubgroups ? `/groups/${groupId}/members/all` : `/groups/${groupId}/members`;
    const members = await this.paginateAll<GitLabMember>(path);
    return members.filter((m) => m.state === "active");
  }

  /** Single-page member fetch for autocomplete (one API call, stays within 3s deadline). */
  async getGroupMembersForAutocomplete(groupId: string): Promise<GitLabMember[]> {
    const members = await this.fetch<GitLabMember[]>(`/groups/${groupId}/members/all`, {
      per_page: "100",
      sort: "asc",
    });
    return members.filter((m) => m.state === "active");
  }

  /** Single-page label fetch for autocomplete. */
  async getGroupLabelsForAutocomplete(groupId: string): Promise<Array<{ name: string }>> {
    return this.fetch<Array<{ name: string }>>(`/groups/${groupId}/labels`, {
      per_page: "100",
    });
  }

  // ─── Merge requests (merged) ────────────────────────────────────────────────

  async getMergedMRsByAuthor(
    groupId: string,
    gitlabUsername: string,
    since: Date,
    until: Date
  ): Promise<GitLabMR[]> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs = await this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      author_username: gitlabUsername,
      state: "merged",
      created_after: fetchSince.toISOString(),
    });

    return allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  /** Fetch merged MRs for the whole group (any author). */
  async getMergedMRsForGroup(groupId: string, since: Date, until: Date): Promise<GitLabMR[]> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs = await this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      state: "merged",
      created_after: fetchSince.toISOString(),
    });

    return allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  /** Fetch merged MRs for a specific project. */
  async getMergedMRsForProject(projectId: number, since: Date, until: Date): Promise<GitLabMR[]> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs = await this.paginateAll<GitLabMR>(`/projects/${projectId}/merge_requests`, {
      state: "merged",
      created_after: fetchSince.toISOString(),
    });

    return allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  /** Fetch merged MRs by milestone title (across group). */
  async getMergedMRsByMilestone(groupId: string, milestoneTitle: string): Promise<GitLabMR[]> {
    return this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      state: "merged",
      milestone: milestoneTitle,
    });
  }

  /** Fetch merged MRs filtered by label (across group). */
  async getMergedMRsByLabel(groupId: string, labels: string, since: Date, until: Date): Promise<GitLabMR[]> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs = await this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      state: "merged",
      labels,
      created_after: fetchSince.toISOString(),
    });

    return allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  // ─── Open MRs (stale / blocked / WIP) ────────────────────────────────────

  async getOpenMRsByAuthor(groupId: string, gitlabUsername: string): Promise<GitLabMR[]> {
    return this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      author_username: gitlabUsername,
      state: "opened",
    }, 3);
  }

  async getStaleMRs(groupId: string, usernames: string[]): Promise<GitLabStaleMR[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_DAYS);
    const now = Date.now();
    const projectCache = new Map<number, GitLabProject | null>();
    const all: GitLabStaleMR[] = [];

    for (const username of usernames) {
      const mrs = await this.getOpenMRsByAuthor(groupId, username);
      for (const mr of mrs) {
        if (mr.draft) continue;
        const updatedAt = new Date(mr.updated_at);
        if (updatedAt >= cutoff) continue;

        if (!projectCache.has(mr.project_id)) {
          projectCache.set(mr.project_id, await this.getProject(mr.project_id));
        }
        const project = projectCache.get(mr.project_id);
        const staleDays = Math.floor((now - updatedAt.getTime()) / 86400000);

        all.push({
          id: mr.id,
          iid: mr.iid,
          title: mr.title,
          web_url: mr.web_url,
          source_branch: mr.source_branch,
          updated_at: mr.updated_at,
          author: mr.author,
          project_id: mr.project_id,
          projectName: project?.name ?? `Project ${mr.project_id}`,
          staleDays,
          reason: staleDays > 14 ? "stale" : "review-stuck",
        });
      }
    }

    return all.sort((a, b) => b.staleDays - a.staleDays);
  }

  // ─── Commits + diff stats ──────────────────────────────────────────────────

  async getCommitsForMR(projectId: number, mrIid: number): Promise<GitLabCommit[]> {
    try {
      return await this.fetch<GitLabCommit[]>(
        `/projects/${projectId}/merge_requests/${mrIid}/commits`,
        { per_page: "20" }
      );
    } catch { return []; }
  }

  async getDiffStats(projectId: number, mrIid: number): Promise<{ additions: number; deletions: number } | null> {
    try {
      const mr = await this.fetch<{
        diff_stats?: { additions: number; deletions: number };
        changes_count?: string;
      }>(`/projects/${projectId}/merge_requests/${mrIid}`);
      if (mr.diff_stats) return mr.diff_stats;
      return { additions: parseInt(mr.changes_count ?? "0"), deletions: 0 };
    } catch { return null; }
  }

  // ─── Projects ───────────────────────────────────────────────────────────────

  async getProject(projectId: number): Promise<GitLabProject | null> {
    try {
      return await this.fetch<GitLabProject>(`/projects/${projectId}`);
    } catch { return null; }
  }

  async getGroupProjects(groupId: string): Promise<GitLabProject[]> {
    return this.paginateAll<GitLabProject>(`/groups/${groupId}/projects`, { include_subgroups: "true" });
  }

  /**
   * Single-page project fetch for autocomplete.
   * Returns up to 100 projects ordered by most recent activity — one API call, fast enough
   * to fit within Discord's 3-second autocomplete deadline.
   */
  async getGroupProjectsForAutocomplete(groupId: string): Promise<GitLabProject[]> {
    return this.fetch<GitLabProject[]>(`/groups/${groupId}/projects`, {
      include_subgroups: "true",
      per_page: "100",
      order_by: "last_activity_at",
      sort: "desc",
    });
  }

  async findProjectByPath(pathOrName: string): Promise<GitLabProject | null> {
    try {
      return await this.fetch<GitLabProject>(`/projects/${encodeURIComponent(pathOrName)}`);
    } catch { return null; }
  }

  // ─── Labels ─────────────────────────────────────────────────────────────────

  async getGroupLabels(groupId: string): Promise<Array<{ name: string; color: string; description: string | null }>> {
    try {
      return await this.paginateAll<{ name: string; color: string; description: string | null }>(
        `/groups/${groupId}/labels`,
        { with_counts: "false" }
      );
    } catch { return []; }
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  async getGroupMilestones(groupId: string): Promise<Array<{ id: number; title: string; state: string; due_date: string | null }>> {
    try {
      return await this.paginateAll<{ id: number; title: string; state: string; due_date: string | null }>(
        `/groups/${groupId}/milestones`,
        {},
        3
      );
    } catch { return []; }
  }

  // ─── Tags (for release notes) ──────────────────────────────────────────────

  async getProjectTags(projectId: number): Promise<GitLabTag[]> {
    return this.paginateAll<GitLabTag>(`/projects/${projectId}/repository/tags`, {}, 3);
  }

  // ─── Review activity ────────────────────────────────────────────────────────

  /**
   * Review activity — 1-2 paginated API calls total, no per-MR notes fetching.
   *
   * Per-MR notes were the main source of unbounded API calls here (up to 20 extra
   * requests for a busy reviewer). We now only fetch the reviewer MR list and parse
   * project names from the web_url — no extra calls needed.
   */
  async getReviewActivity(
    groupId: string,
    gitlabUsername: string,
    since: Date,
    until: Date
  ): Promise<ReviewActivity> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs = await this.paginateAll<GitLabMR>(`/groups/${groupId}/merge_requests`, {
      reviewer_username: gitlabUsername,
      state: "merged",
      created_after: fetchSince.toISOString(),
    }, 3);  // max 3 pages

    const inRange = allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });

    // Parse project name from web_url — free, no API call
    const reviewedMRs: ReviewActivity["reviewedMRs"] = inRange.slice(0, 15).map((mr) => {
      let projectName = `Project ${mr.project_id}`;
      try {
        const parts = new URL(mr.web_url).pathname.split("/-/")[0].split("/").filter(Boolean);
        projectName = parts.at(-1) ?? projectName;
      } catch { /* best-effort */ }
      return { title: mr.title, web_url: mr.web_url, projectName };
    });

    return {
      username: gitlabUsername,
      displayName: gitlabUsername,
      reviewsGiven: inRange.length,
      approvals: 0,          // would need per-MR notes — too expensive
      commentsLeft: 0,
      discussionsResolved: 0,
      reviewedMRs,
    };
  }

  // ─── Enriched MRs ──────────────────────────────────────────────────────────

  /**
   * Lite enrichment: O(unique_projects) API calls — never O(N) per MR.
   *
   * - Project name/URL resolved once per unique project_id (parallel, cached).
   * - Commits skipped (titles + descriptions are enough for AI summarisation).
   * - Diff stats derived from `changes_count` already present in the list response
   *   (files changed, not lines — avoids one extra API call per MR).
   *
   * This is the only `enrichMRs` — the old per-MR commits/diffs version was the
   * primary cause of "Too many subrequests" on the free plan.
   */
  async enrichMRs(mrs: GitLabMR[]): Promise<EnrichedMR[]> {
    if (mrs.length === 0) return [];

    // Resolve unique projects in parallel — typically 1-5 calls total, not N
    const uniqueIds = [...new Set(mrs.map((m) => m.project_id))];
    const projectMap = new Map<number, GitLabProject | null>();
    await Promise.all(
      uniqueIds.map(async (id) => {
        projectMap.set(id, await this.getProject(id));
      })
    );

    return mrs.map((mr): EnrichedMR => {
      const project = projectMap.get(mr.project_id);
      const filesChanged = parseInt(mr.changes_count ?? "0", 10) || 0;
      const isRevert = /^Revert\s+"/i.test(mr.title) || mr.source_branch.startsWith("revert-");
      return {
        ...mr,
        projectName: project?.name ?? `Project ${mr.project_id}`,
        projectUrl:  project?.web_url ?? "",
        commits:  [],          // not fetched — saves N API calls
        diffStats: filesChanged > 0 ? { additions: filesChanged, deletions: 0 } : null,
        isRevert,
      };
    });
  }
}
