import { GitLabClient } from "./client";
import type { Env, ChangelogData, ChangelogFormat } from "../types";
import { parseWeek } from "../utils/weeks";

/**
 * Build a changelog for a single GitLab user over the given ISO week.
 * displayName is whatever label to show (GitLab name, Discord username, etc.)
 */
export async function buildChangelogForUser(
  gitlabUsername: string,
  displayName: string,
  env: Env,
  weekISO: string,
  format: ChangelogFormat
): Promise<ChangelogData> {
  const week = parseWeek(weekISO);
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  const [mergedMRs, staleMRs] = await Promise.all([
    client.getEnrichedMRs(env.GITLAB_GROUP_ID, gitlabUsername, week.weekStart, week.weekEnd),
    client.getEnrichedStaleMRs(env.GITLAB_GROUP_ID, [gitlabUsername]),
  ]);

  return {
    gitlabUsername,
    displayName,
    mergedMRs,
    staleMRs,
    aiSummary: "",
    weekISO: week.weekISO,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    format,
  };
}

/**
 * Build a combined changelog for all members of a GitLab group.
 * Used by the weekly cron and /changelog generate all:true.
 */
export async function buildChangelogForGroup(
  groupId: string,
  env: Env,
  weekISO: string,
  format: ChangelogFormat
): Promise<ChangelogData[]> {
  const week = parseWeek(weekISO);
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  const members = await client.getGroupMembers(groupId, true);

  return Promise.all(
    members.map(async (member) => {
      const [mergedMRs, staleMRs] = await Promise.all([
        client.getEnrichedMRs(groupId, member.username, week.weekStart, week.weekEnd),
        client.getEnrichedStaleMRs(groupId, [member.username]),
      ]);

      return {
        gitlabUsername: member.username,
        displayName: member.name,
        mergedMRs,
        staleMRs,
        aiSummary: "",
        weekISO: week.weekISO,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        format,
      };
    })
  );
}
