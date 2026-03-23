import type { ChangelogData, Env, UserMapping } from "../types";
import { GitLabClient } from "./client";

export function getWeekRange(): { weekStart: Date; weekEnd: Date } {
  const now = new Date();
  const weekEnd = new Date(now);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  return { weekStart, weekEnd };
}

export async function buildChangelogForUser(
  user: UserMapping,
  env: Env,
  weekStart: Date,
  weekEnd: Date
): Promise<ChangelogData> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  const mergedMRs = await client.getMergedMRsByAuthor(
    env.GITLAB_GROUP_ID,
    user.gitlabUsername,
    weekStart,
    weekEnd
  );

  // Fetch project names and commits in parallel (cap at 10 MRs to stay within limits)
  const capped = mergedMRs.slice(0, 10);

  const enriched = await Promise.all(
    capped.map(async (mr) => {
      const [project, commits] = await Promise.all([
        client.getProject(mr.project_id).catch(() => ({ name: "Unknown", id: mr.project_id, name_with_namespace: "Unknown", web_url: "" })),
        client.getMRCommits(mr.project_id, mr.iid),
      ]);

      return {
        ...mr,
        projectName: project.name,
        commits,
      };
    })
  );

  return {
    user,
    mergedMRs: enriched,
    aiSummary: "",
    weekStart,
    weekEnd,
  };
}
