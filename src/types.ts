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

export interface UserMapping {
  discordId: string;
  discordUsername: string;
  gitlabUsername: string;
}

export interface GitLabMR {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  merged_at: string;
  web_url: string;
  references: { full: string };
  source_branch: string;
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
}

export interface ChangelogData {
  user: UserMapping;
  mergedMRs: (GitLabMR & { projectName: string; commits: GitLabCommit[] })[];
  aiSummary: string;
  weekStart: Date;
  weekEnd: Date;
}

export type ChangelogFormat = "changelog" | "pr" | "press-release";

// Discord interaction types
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export const ApplicationCommandOptionType = {
  SUB_COMMAND: 1,
  STRING: 3,
  USER: 6,
} as const;

export interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: {
    name: string;
    options?: DiscordCommandOption[];
  };
}

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number;
  options?: DiscordCommandOption[];
}
