import type { GitLabCommit, GitLabMR, GitLabProject } from "../types";

export class GitLabClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async fetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v4${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`GitLab API error ${res.status} for ${path}: ${await res.text()}`);
    }

    return res.json() as Promise<T>;
  }

  async getMergedMRsByAuthor(
    groupId: string,
    gitlabUsername: string,
    since: Date,
    until: Date
  ): Promise<GitLabMR[]> {
    // GitLab's group MR endpoint ignores merged_after/merged_before silently,
    // so we fetch with a wide created_after window and filter client-side by merged_at.
    const fetchSince = new Date(since);
    fetchSince.setDate(fetchSince.getDate() - 30);

    const allMRs: GitLabMR[] = [];
    let page = 1;

    while (true) {
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
      page++;
    }

    // Filter to only MRs merged within the requested window
    return allMRs.filter((mr) => {
      const mergedAt = new Date(mr.merged_at);
      return mergedAt >= since && mergedAt <= until;
    });
  }

  async getMRCommits(projectId: number, mrIid: number): Promise<GitLabCommit[]> {
    try {
      return await this.fetch<GitLabCommit[]>(
        `/projects/${projectId}/merge_requests/${mrIid}/commits`,
        { per_page: "20" }
      );
    } catch {
      return [];
    }
  }

  async getProject(projectId: number): Promise<GitLabProject> {
    return this.fetch<GitLabProject>(`/projects/${projectId}`);
  }
}
