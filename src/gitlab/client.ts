import type {
  GitLabMember,
  GitLabMR,
  GitLabCommit,
  GitLabProject,
  GitLabStaleMR,
  EnrichedMR,
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
      throw new Error(`GitLab API ${url} → ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Group members (source of truth for "who's on the team") ──────────────

  async getGroupMembers(groupId: string, includeSubgroups = false): Promise<GitLabMember[]> {
    const path = includeSubgroups
      ? `/groups/${groupId}/members/all`
      : `/groups/${groupId}/members`;

    const members: GitLabMember[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.fetch<GitLabMember[]>(path, {
        per_page: "100",
        page: String(page),
      });
      if (batch.length === 0) break;
      // Only include active members (state === "active")
      members.push(...batch.filter((m) => m.state === "active"));
      if (batch.length < 100) break;
    }
    return members;
  }

  // ─── Merge requests ────────────────────────────────────────────────────────

  /**
   * GitLab group MR endpoint silently ignores merged_after/merged_before,
   * so we fetch with created_after (30-day buffer) and filter client-side.
   */
  async getMergedMRsByAuthor(
    groupId: string,
    gitlabUsername: string,
    since: Date,
    until: Date
  ): Promise<GitLabMR[]> {
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs: GitLabMR[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const mrs = await this.fetch<GitLabMR[]>(`/groups/${groupId}/merge_requests`, {
        author_username: gitlabUsername,
        state: "merged",
        created_after: fetchSince.toISOString(),
        per_page: "100",
        page: String(page),
      });
      if (mrs.length === 0) break;
      allMRs.push(...mrs);
      if (mrs.length < 100) break;
    }

    return allMRs.filter((mr) => {
      if (mr.draft) return false;
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  /** Open MRs not updated in STALE_DAYS — the "blockers" view. */
  async getStaleMRsByAuthor(groupId: string, gitlabUsername: string): Promise<GitLabMR[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_DAYS);

    const allMRs: GitLabMR[] = [];
    for (let page = 1; page <= 3; page++) {
      const mrs = await this.fetch<GitLabMR[]>(`/groups/${groupId}/merge_requests`, {
        author_username: gitlabUsername,
        state: "opened",
        per_page: "50",
        page: String(page),
      });
      if (mrs.length === 0) break;
      allMRs.push(...mrs);
      if (mrs.length < 50) break;
    }

    return allMRs.filter((mr) => !mr.draft && new Date(mr.updated_at) < cutoff);
  }

  // ─── Commits + diff stats ──────────────────────────────────────────────────

  async getCommitsForMR(projectId: number, mrIid: number): Promise<GitLabCommit[]> {
    try {
      return await this.fetch<GitLabCommit[]>(
        `/projects/${projectId}/merge_requests/${mrIid}/commits`,
        { per_page: "20" }
      );
    } catch {
      return [];
    }
  }

  async getDiffStats(projectId: number, mrIid: number): Promise<{ additions: number; deletions: number } | null> {
    try {
      const mr = await this.fetch<{
        diff_stats?: { additions: number; deletions: number };
        changes_count?: string;
      }>(`/projects/${projectId}/merge_requests/${mrIid}`);
      if (mr.diff_stats) return mr.diff_stats;
      const n = parseInt(mr.changes_count ?? "0");
      return { additions: n, deletions: 0 };
    } catch {
      return null;
    }
  }

  // ─── Projects ───────────────────────────────────────────────────────────────

  async getProject(projectId: number): Promise<GitLabProject | null> {
    try {
      return await this.fetch<GitLabProject>(`/projects/${projectId}`);
    } catch {
      return null;
    }
  }

  async getGroupProjects(groupId: string): Promise<GitLabProject[]> {
    const projects: GitLabProject[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.fetch<GitLabProject[]>(`/groups/${groupId}/projects`, {
        per_page: "100",
        page: String(page),
        include_subgroups: "true",
      });
      if (batch.length === 0) break;
      projects.push(...batch);
      if (batch.length < 100) break;
    }
    return projects;
  }

  // ─── Enriched MRs ─────────────────────────────────────────────────────────

  async getEnrichedMRs(
    groupId: string,
    gitlabUsername: string,
    since: Date,
    until: Date
  ): Promise<EnrichedMR[]> {
    const mrs = await this.getMergedMRsByAuthor(groupId, gitlabUsername, since, until);
    if (mrs.length === 0) return [];

    const projectCache = new Map<number, GitLabProject | null>();

    const enriched = await Promise.all(
      mrs.map(async (mr): Promise<EnrichedMR> => {
        if (!projectCache.has(mr.project_id)) {
          projectCache.set(mr.project_id, await this.getProject(mr.project_id));
        }
        const project = projectCache.get(mr.project_id);
        const [commits, diffStats] = await Promise.all([
          this.getCommitsForMR(mr.project_id, mr.iid),
          this.getDiffStats(mr.project_id, mr.iid),
        ]);

        return {
          ...mr,
          projectName: project?.name ?? `Project ${mr.project_id}`,
          projectUrl: project?.web_url ?? "",
          commits,
          diffStats,
        };
      })
    );

    return enriched.sort(
      (a, b) => new Date(b.merged_at).getTime() - new Date(a.merged_at).getTime()
    );
  }

  async getEnrichedStaleMRs(groupId: string, usernames: string[]): Promise<GitLabStaleMR[]> {
    const projectCache = new Map<number, GitLabProject | null>();
    const now = Date.now();
    const all: GitLabStaleMR[] = [];

    for (const username of usernames) {
      const mrs = await this.getStaleMRsByAuthor(groupId, username);
      for (const mr of mrs) {
        if (!projectCache.has(mr.project_id)) {
          projectCache.set(mr.project_id, await this.getProject(mr.project_id));
        }
        const project = projectCache.get(mr.project_id);
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
          staleDays: Math.floor((now - new Date(mr.updated_at).getTime()) / 86400000),
        });
      }
    }

    return all.sort((a, b) => b.staleDays - a.staleDays);
  }
}
