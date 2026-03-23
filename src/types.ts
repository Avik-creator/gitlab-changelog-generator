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

// ─── Discord ↔ GitLab mapping (the only thing we store) ──────────────────────

export interface UserMapping {
  discordId: string;
  discordUsername: string;
  gitlabUsername: string;
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
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  authored_date: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  web_url: string;
  path_with_namespace: string;
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
}

export interface EnrichedMR extends GitLabMR {
  projectName: string;
  projectUrl: string;
  commits: GitLabCommit[];
  diffStats: { additions: number; deletions: number } | null;
}

// ─── Changelog pipeline ───────────────────────────────────────────────────────

export type ChangelogFormat = "changelog" | "pr" | "press-release" | "release-notes" | "concise";

export interface ChangelogData {
  gitlabUsername: string;
  displayName: string;         // GitLab name or Discord username
  mergedMRs: EnrichedMR[];
  staleMRs: GitLabStaleMR[];
  aiSummary: string;
  weekISO: string;
  weekStart: Date;
  weekEnd: Date;
  format: ChangelogFormat;
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
}

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}
