import type { EnrichedMR, FilterConfig, GitLabMR } from "../types";

export interface FilterResult {
  passed: EnrichedMR[];
  filteredOut: number;
  revertPairs: Map<number, string>;   // mrId → revertedBy URL
}

/**
 * Apply all configured filters to a list of enriched MRs.
 * Returns MRs that pass, count of filtered-out, and detected revert pairs.
 */
export function applyFilters(mrs: EnrichedMR[], config: FilterConfig): FilterResult {
  const revertPairs = detectReverts(mrs);
  let filteredOut = 0;

  const passed = mrs.filter((mr) => {
    const reason = getExclusionReason(mr, config, revertPairs);
    if (reason) {
      filteredOut++;
      return false;
    }
    return true;
  });

  return { passed, filteredOut, revertPairs };
}

function getExclusionReason(
  mr: EnrichedMR,
  config: FilterConfig,
  revertPairs: Map<number, string>
): string | null {
  // Draft exclusion
  if (!config.includeDrafts && mr.draft) return "draft";

  // Bot author exclusion
  if (config.excludeBotAuthors) {
    const username = mr.author.username.toLowerCase();
    for (const pattern of config.excludeBotPatterns) {
      if (new RegExp(pattern, "i").test(username)) return "bot-author";
    }
  }

  // Title pattern exclusion
  for (const pattern of config.excludeTitlePatterns) {
    if (new RegExp(pattern, "i").test(mr.title)) return "title-pattern";
  }

  // Label exclusion
  if (config.excludeLabels.length > 0) {
    const lowerLabels = mr.labels.map((l) => l.toLowerCase());
    for (const excluded of config.excludeLabels) {
      if (lowerLabels.includes(excluded.toLowerCase())) return "label";
    }
  }

  // Label inclusion filter (if set, only include MRs with at least one matching label)
  if (config.includeLabels.length > 0) {
    const lowerLabels = mr.labels.map((l) => l.toLowerCase());
    const hasMatch = config.includeLabels.some((inc) =>
      lowerLabels.includes(inc.toLowerCase())
    );
    if (!hasMatch) return "label-not-included";
  }

  // Repo exclusion/inclusion
  const repoPath = mr.projectUrl
    ? new URL(mr.projectUrl).pathname.slice(1)
    : "";
  const repoName = mr.projectName.toLowerCase();

  if (config.excludeRepos.length > 0) {
    for (const excluded of config.excludeRepos) {
      const lower = excluded.toLowerCase();
      if (repoName === lower || repoPath.toLowerCase().includes(lower)) return "repo-excluded";
    }
  }

  if (config.includeRepos.length > 0) {
    const hasMatch = config.includeRepos.some((inc) => {
      const lower = inc.toLowerCase();
      return repoName === lower || repoPath.toLowerCase().includes(lower);
    });
    if (!hasMatch) return "repo-not-included";
  }

  // Minimum diff threshold
  if (config.minLines > 0 && mr.diffStats) {
    const total = mr.diffStats.additions + mr.diffStats.deletions;
    if (total < config.minLines) return "below-min-lines";
  }

  // Minimum commits threshold
  if (config.minCommits > 0 && mr.commits.length < config.minCommits) return "below-min-commits";

  // Revert exclusion
  if (config.excludeReverted && revertPairs.has(mr.id)) return "reverted";

  return null;
}

/**
 * Detect revert pairs by matching MR titles.
 * GitLab typically creates reverts with title: "Revert \"Original Title\""
 */
function detectReverts(mrs: EnrichedMR[]): Map<number, string> {
  const pairs = new Map<number, string>();
  const revertPattern = /^Revert\s+"(.+)"$/i;

  const titleToMR = new Map<string, EnrichedMR>();
  for (const mr of mrs) {
    titleToMR.set(mr.title.toLowerCase(), mr);
  }

  for (const mr of mrs) {
    const match = revertPattern.exec(mr.title);
    if (match) {
      const originalTitle = match[1]!.toLowerCase();
      const original = titleToMR.get(originalTitle);
      if (original) {
        // Mark both the original and the revert as "reverted"
        pairs.set(original.id, mr.web_url);
        pairs.set(mr.id, original.web_url);
      }
    }

    // Also check branch names: revert-<branch-name>
    if (mr.source_branch.startsWith("revert-")) {
      const revertedBranch = mr.source_branch.slice(7);
      const original = mrs.find(
        (m) => m.source_branch === revertedBranch && m.id !== mr.id
      );
      if (original && !pairs.has(original.id)) {
        pairs.set(original.id, mr.web_url);
        pairs.set(mr.id, original.web_url);
      }
    }
  }

  return pairs;
}

/**
 * Assess input quality.
 *
 * When commits are available, assess their message quality.
 * When commits are empty (lite enrichment path), fall back to assessing MR titles —
 * which is always available and is a perfectly good signal.
 */
export function assessInputQuality(mrs: EnrichedMR[]): "high" | "medium" | "low" {
  if (mrs.length === 0) return "low";

  const allCommits = mrs.flatMap((mr) => mr.commits);

  // Lite enrichment path: no commits fetched — use MR titles instead
  if (allCommits.length === 0) {
    return assessTitleQuality(mrs);
  }

  const garbagePatterns = [
    /^(fix|wip|test|update|again|done|stuff|tmp|temp|asdf|xxx)$/i,
    /^.{1,5}$/,
    /^Merge branch/i,
    /^initial commit$/i,
  ];

  let garbageCount = 0;
  for (const commit of allCommits) {
    if (garbagePatterns.some((p) => p.test(commit.title.trim()))) garbageCount++;
  }
  const ratio = garbageCount / allCommits.length;
  if (ratio > 0.6) return "low";
  if (ratio > 0.3) return "medium";
  return "high";
}

function assessTitleQuality(mrs: EnrichedMR[]): "high" | "medium" | "low" {
  // Short/vague MR titles that give the AI nothing to work with
  const garbagePatterns = [
    /^.{1,8}$/,                         // 8 chars or fewer
    /^(fix|wip|update|test|patch|misc)$/i,
    /^Merge (branch|request|pull)/i,
    /^Revert "/i,
    /^draft/i,
  ];

  let garbageCount = 0;
  for (const mr of mrs) {
    if (garbagePatterns.some((p) => p.test(mr.title.trim()))) garbageCount++;
  }

  const ratio = garbageCount / mrs.length;
  if (ratio > 0.7) return "low";
  if (ratio > 0.4) return "medium";
  return "high";
}
