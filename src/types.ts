// ─── Cloudflare env ───────────────────────────────────────────────────────────

export interface Env {
  USERS_KV: KVNamespace;
  AI: Ai;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_CHANGELOG_CHANNEL_ID: string;
  GITLAB_TOKEN: string;
  GITLAB_BASE_URL: string;
  GITLAB_GROUP_ID: string;
}

// ─── Discord ↔ GitLab mapping ────────────────────────────────────────────────

export interface UserMapping {
  discordId: string;
  discordUsername: string;
  gitlabUsername: string;
}

// ─── Config (stored in KV) ───────────────────────────────────────────────────

export interface FilterConfig {
  includeDrafts: boolean;
  excludeLabels: string[];
  includeLabels: string[];
  excludeRepos: string[];
  includeRepos: string[];
  excludeTitlePatterns: string[];    // regex patterns: WIP, chore, bump, etc.
  excludeBotAuthors: boolean;
  excludeBotPatterns: string[];      // e.g. "dependabot", "renovate"
  minLines: number;                  // minimum additions+deletions to include
  minCommits: number;                // minimum commits per MR
  excludeReverted: boolean;
}

export interface UserConfig {
  filters: Partial<FilterConfig>;
  timezone: string;
  style: DigestMode;
  verbosity: "brief" | "normal" | "detailed";
  excludeRepos: string[];
  includeRepos: string[];
}

export interface GlobalConfig {
  filters: FilterConfig;
  defaultStyle: DigestMode;
  defaultVerbosity: "brief" | "normal" | "detailed";
}

export const DEFAULT_FILTERS: FilterConfig = {
  includeDrafts: false,
  excludeLabels: ["chore", "dependencies", "ci", "skip-changelog"],
  includeLabels: [],
  excludeRepos: [],
  includeRepos: [],
  excludeTitlePatterns: [
    "^WIP:",
    "^Draft:",
    "^\\[skip ci\\]",
    "^bump\\b",
    "^chore\\(",
    "^update dependencies",
    "^Merge branch",
  ],
  excludeBotAuthors: true,
  excludeBotPatterns: ["bot$", "\\[bot\\]$", "^dependabot", "^renovate", "^gitlab-bot"],
  minLines: 0,
  minCommits: 0,
  excludeReverted: true,
};

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  filters: DEFAULT_FILTERS,
  defaultStyle: "changelog",
  defaultVerbosity: "normal",
};

// ─── Digest modes ─────────────────────────────────────────────────────────────

export type DigestMode =
  | "changelog"       // default: professional prose
  | "pr"              // technical bullet points
  | "press-release"   // marketing/stakeholder
  | "release-notes"   // structured Features/Fixes/Improvements
  | "concise"         // 2-sentence TL;DR
  | "manager"         // impact + blockers + cross-team context
  | "engineering"     // deep technical detail
  | "executive";      // high-level business impact

// ─── Changelog scoping ───────────────────────────────────────────────────────

export type ScopeType = "user" | "all" | "project" | "label" | "milestone";

export interface ChangelogScope {
  type: ScopeType;
  value: string;       // gitlabUsername | projectPath | label | milestone title
}

export interface DateRange {
  since: Date;
  until: Date;
  label: string;       // human display: "Mar 10 – Mar 16, 2026"
  isoWeek?: string;    // "2026-W12" if week-based
}

// ─── GitLab types ─────────────────────────────────────────────────────────────

export interface GitLabMember {
  id: number;
  username: string;
  name: string;
  state: string;
  access_level: number;
}

export interface GitLabMR {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  merged_at: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  draft: boolean;
  labels: string[];
  changes_count: string;
  milestone: { title: string; web_url: string } | null;
  author: { username: string; name: string };
  reviewers?: { username: string; name: string }[];
  user_notes_count?: number;
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  message: string;
  authored_date: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  web_url: string;
  path_with_namespace: string;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: { username: string; name: string };
  created_at: string;
  system: boolean;
  resolvable: boolean;
  resolved: boolean;
}

export interface GitLabTag {
  name: string;
  message: string;
  commit: { id: string; created_at: string };
}

export interface GitLabStaleMR {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  source_branch: string;
  updated_at: string;
  author: { username: string; name: string };
  project_id: number;
  projectName: string;
  staleDays: number;
  reason: "stale" | "review-stuck" | "pipeline-failed" | "blocked";
}

export interface EnrichedMR extends GitLabMR {
  projectName: string;
  projectUrl: string;
  commits: GitLabCommit[];
  diffStats: { additions: number; deletions: number } | null;
  isRevert: boolean;
  revertedBy?: string;        // MR URL that reverted this
}

// ─── Review activity ──────────────────────────────────────────────────────────

export interface ReviewActivity {
  username: string;
  displayName: string;
  reviewsGiven: number;
  approvals: number;
  commentsLeft: number;
  discussionsResolved: number;
  reviewedMRs: Array<{ title: string; web_url: string; projectName: string }>;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface UserStats {
  username: string;
  displayName: string;
  mrsMerged: number;
  totalAdditions: number;
  totalDeletions: number;
  reposContributed: string[];
  avgTimeToMerge: number;      // hours
  reviewActivity: ReviewActivity;
  labelsUsed: Record<string, number>;
}

// ─── Changelog pipeline ──────────────────────────────────────────────────────

export interface ChangelogData {
  gitlabUsername: string;
  displayName: string;
  scope: ChangelogScope;
  dateRange: DateRange;
  mergedMRs: EnrichedMR[];
  filteredOutCount: number;
  staleMRs: GitLabStaleMR[];
  openMRs: EnrichedMR[];       // work-in-progress
  reviewActivity: ReviewActivity | null;
  aiSummary: string;
  format: DigestMode;
  trend?: TrendData;       // optional comparison vs. previous equivalent period
  inputQuality: "high" | "medium" | "low";
  weekISO: string;
  weekStart: Date;
  weekEnd: Date;
}

// ─── Trend / comparison data ─────────────────────────────────────────────────

export interface TrendData {
  mrsDelta: number;        // positive = more this period
  linesDelta: number;      // net change in additions + deletions
  reviewsDelta: number;
  reposDelta: number;
  prevLabel: string;       // e.g. "2026-W11" or "30 days ago"
}

// ─── Release notes ────────────────────────────────────────────────────────────

export interface ReleaseScope {
  type: "milestone" | "tag-range" | "date-range";
  milestone?: string;
  fromTag?: string;
  toTag?: string;
  from?: Date;
  to?: Date;
}

export interface ReleaseData {
  scope: ReleaseScope;
  label: string;
  features: EnrichedMR[];
  fixes: EnrichedMR[];
  improvements: EnrichedMR[];
  breaking: EnrichedMR[];
  internal: EnrichedMR[];
  aiSummary: string;
}

// ─── Discord interaction types ────────────────────────────────────────────────

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: {
    name: string;
    custom_id?: string;
    options?: DiscordCommandOption[];
  };
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
  channel_id?: string;
}

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}
