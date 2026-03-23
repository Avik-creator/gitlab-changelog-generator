import type {
  UserConfig,
  GlobalConfig,
  FilterConfig,
  DigestMode,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_FILTERS,
} from "../types";

// Re-import defaults as values (types file exports them as consts)
import { DEFAULT_GLOBAL_CONFIG as DEFAULTS, DEFAULT_FILTERS as FILTER_DEFAULTS } from "../types";

// ─── Global config ────────────────────────────────────────────────────────────

export async function getGlobalConfig(kv: KVNamespace): Promise<GlobalConfig> {
  const raw = await kv.get("config:global");
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export async function setGlobalConfig(kv: KVNamespace, config: Partial<GlobalConfig>): Promise<GlobalConfig> {
  const current = await getGlobalConfig(kv);
  const merged = {
    ...current,
    ...config,
    filters: { ...current.filters, ...(config.filters ?? {}) },
  };
  await kv.put("config:global", JSON.stringify(merged));
  return merged;
}

// ─── Per-user config ──────────────────────────────────────────────────────────

const DEFAULT_USER_CONFIG: UserConfig = {
  filters: {},
  timezone: "UTC",
  style: "changelog",
  verbosity: "normal",
  excludeRepos: [],
  includeRepos: [],
};

export async function getUserConfig(kv: KVNamespace, discordIdOrGitlab: string): Promise<UserConfig> {
  const raw = await kv.get(`config:user:${discordIdOrGitlab}`);
  if (!raw) return DEFAULT_USER_CONFIG;
  try {
    return { ...DEFAULT_USER_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_USER_CONFIG;
  }
}

export async function setUserConfig(
  kv: KVNamespace,
  discordIdOrGitlab: string,
  config: Partial<UserConfig>
): Promise<UserConfig> {
  const current = await getUserConfig(kv, discordIdOrGitlab);
  const merged: UserConfig = {
    ...current,
    ...config,
    filters: { ...current.filters, ...(config.filters ?? {}) },
  };
  await kv.put(`config:user:${discordIdOrGitlab}`, JSON.stringify(merged));
  return merged;
}

// ─── Resolve effective filters (global merged with user overrides) ────────────

export function resolveFilters(global: GlobalConfig, user?: UserConfig): FilterConfig {
  const base = global.filters;
  const overrides = user?.filters ?? {};

  return {
    includeDrafts: overrides.includeDrafts ?? base.includeDrafts,
    excludeLabels: overrides.excludeLabels ?? base.excludeLabels,
    includeLabels: overrides.includeLabels ?? base.includeLabels,
    excludeRepos: [
      ...base.excludeRepos,
      ...(user?.excludeRepos ?? []),
      ...(overrides.excludeRepos ?? []),
    ],
    includeRepos: [
      ...(user?.includeRepos ?? []),
      ...(overrides.includeRepos ?? []),
    ],
    excludeTitlePatterns: overrides.excludeTitlePatterns ?? base.excludeTitlePatterns,
    excludeBotAuthors: overrides.excludeBotAuthors ?? base.excludeBotAuthors,
    excludeBotPatterns: overrides.excludeBotPatterns ?? base.excludeBotPatterns,
    minLines: overrides.minLines ?? base.minLines,
    minCommits: overrides.minCommits ?? base.minCommits,
    excludeReverted: overrides.excludeReverted ?? base.excludeReverted,
  };
}

export function resolveStyle(global: GlobalConfig, user?: UserConfig): DigestMode {
  return user?.style ?? global.defaultStyle;
}
