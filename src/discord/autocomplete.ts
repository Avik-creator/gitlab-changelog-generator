/**
 * Discord autocomplete handlers (interaction type 4).
 *
 * These fire as the user types into autocomplete-enabled fields.
 * They must return within ~3 seconds and provide up to 25 choices.
 * Results are cached in KV with short TTLs to keep GitLab API calls minimal.
 */

import type { Env, DiscordInteraction, DiscordCommandOption, GitLabProject } from "../types";
import { GitLabClient } from "../gitlab/client";
import { getAllMappings } from "../kv/users";

interface AutocompleteChoice {
  name: string;
  value: string;
}

const CACHE_TTL = 300; // 5 min

// ─── Cache helpers ─────────────────────────────────────────────────────────────

async function cached<T>(kv: KVNamespace, key: string, fn: () => Promise<T>): Promise<T> {
  const raw = await kv.get(`ac:${key}`);
  if (raw) return JSON.parse(raw) as T;
  const data = await fn();
  await kv.put(`ac:${key}`, JSON.stringify(data), { expirationTtl: CACHE_TTL });
  return data;
}

function filterChoices(choices: AutocompleteChoice[], query: string): AutocompleteChoice[] {
  const q = query.toLowerCase();
  const matched = choices.filter(
    (c) => c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)
  );
  return matched.slice(0, 25);
}

// ─── Individual handlers ──────────────────────────────────────────────────────

/** GitLab group members — for the `gitlab` string field */
async function suggestGitlabUsers(env: Env, query: string): Promise<AutocompleteChoice[]> {
  const members = await cached(env.USERS_KV, `members:${env.GITLAB_GROUP_ID}`, async () => {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    return client.getGroupMembers(env.GITLAB_GROUP_ID, true);
  });

  const choices: AutocompleteChoice[] = members.map((m) => ({
    name: `${m.name} (@${m.username})`,
    value: m.username,
  }));

  return filterChoices(choices, query);
}

/** GitLab group projects — for the `project` field */
async function suggestProjects(env: Env, query: string): Promise<AutocompleteChoice[]> {
  const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

  // Try KV cache first (5-min TTL), then do a single-page fetch — no pagination
  // so we always stay inside Discord's 3-second autocomplete deadline.
  const cacheKey = `projects:${env.GITLAB_GROUP_ID}`;
  const raw = await env.USERS_KV.get(`ac:${cacheKey}`).catch(() => null);

  let projects: GitLabProject[];
  if (raw) {
    projects = JSON.parse(raw) as GitLabProject[];
  } else {
    projects = await client.getGroupProjectsForAutocomplete(env.GITLAB_GROUP_ID);
    await env.USERS_KV.put(`ac:${cacheKey}`, JSON.stringify(projects), { expirationTtl: CACHE_TTL })
      .catch(() => { /* non-fatal */ });
  }

  const choices: AutocompleteChoice[] = projects.map((p) => ({
    name: p.name_with_namespace.length <= 100
      ? p.name_with_namespace
      : p.name,
    value: p.path_with_namespace,
  }));

  return filterChoices(choices, query);
}

/** GitLab group labels — for the `label` field */
async function suggestLabels(env: Env, query: string): Promise<AutocompleteChoice[]> {
  const labels = await cached(env.USERS_KV, `labels:${env.GITLAB_GROUP_ID}`, async () => {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    return client.getGroupLabels(env.GITLAB_GROUP_ID);
  });

  const choices: AutocompleteChoice[] = labels.map((l) => ({
    name: l.name,
    value: l.name,
  }));

  return filterChoices(choices, query);
}

/** GitLab group milestones — for the `milestone` field */
async function suggestMilestones(env: Env, query: string): Promise<AutocompleteChoice[]> {
  const milestones = await cached(env.USERS_KV, `milestones:${env.GITLAB_GROUP_ID}`, async () => {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    return client.getGroupMilestones(env.GITLAB_GROUP_ID);
  });

  const choices: AutocompleteChoice[] = milestones.map((m) => ({
    name: `${m.title}${m.state === "closed" ? " ✓" : ""}`,
    value: m.title,
  }));

  return filterChoices(choices, query);
}

/** Discord-linked users — for the `gitlab` field in /changelog link */
async function suggestLinkedUsers(env: Env, query: string): Promise<AutocompleteChoice[]> {
  const mappings = await getAllMappings(env.USERS_KV).catch(() => []);
  const choices: AutocompleteChoice[] = mappings.map((m) => ({
    name: `@${m.discordUsername} → ${m.gitlabUsername}`,
    value: m.gitlabUsername,
  }));
  return filterChoices(choices, query);
}

// ─── Week presets — for the `week` field ─────────────────────────────────────

function suggestWeeks(query: string): AutocompleteChoice[] {
  const now = new Date();

  // Build the last 8 ISO weeks as choices
  const choices: AutocompleteChoice[] = [
    { name: "Last week (default)", value: "last" },
    { name: "This week", value: "this" },
  ];

  for (let i = 1; i <= 6; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i * 7);
    const weekNum = isoWeekNum(d);
    const year = isoWeekYear(d);
    const isoStr = `${year}-W${String(weekNum).padStart(2, "0")}`;
    const mon = mondayOf(d);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    const label = `${mon.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${sun.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
    choices.push({ name: `${isoStr} (${label})`, value: isoStr });
  }

  return filterChoices(choices, query);
}

function suggestRanges(query: string): AutocompleteChoice[] {
  const choices: AutocompleteChoice[] = [
    { name: "Last 7 days", value: "7d" },
    { name: "Last 14 days", value: "14d" },
    { name: "Last 30 days", value: "30d" },
    { name: "This month", value: "this-month" },
    { name: "Last month", value: "last-month" },
  ];

  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const name = d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    choices.push({ name, value: monthStr });
  }

  return filterChoices(choices, query);
}

// ─── ISO week helpers (self-contained to avoid circular imports) ──────────────

function isoWeekNum(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isoWeekYear(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  return date.getUTCFullYear();
}

function mondayOf(d: Date): Date {
  const day = d.getUTCDay() || 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  mon.setUTCDate(mon.getUTCDate() - (day - 1));
  return mon;
}

// ─── Main router ──────────────────────────────────────────────────────────────

/**
 * Finds the focused option anywhere in the option tree (including nested subcommands).
 */
function findFocused(options: DiscordCommandOption[]): { name: string; query: string } | null {
  for (const opt of options) {
    if ((opt as unknown as { focused?: boolean }).focused) {
      return { name: opt.name, query: String(opt.value ?? "") };
    }
    if (opt.options) {
      const nested = findFocused(opt.options);
      if (nested) return nested;
    }
  }
  return null;
}

export async function handleAutocomplete(
  interaction: DiscordInteraction,
  env: Env
): Promise<Response> {
  const options = interaction.data?.options ?? [];
  const focused = findFocused(options);

  if (!focused) return Response.json({ type: 8, data: { choices: [] } });

  const { name, query } = focused;

  let choices: AutocompleteChoice[] = [];

  try {
    switch (name) {
      case "gitlab":
        choices = await suggestGitlabUsers(env, query);
        break;
      case "project":
        choices = await suggestProjects(env, query);
        break;
      case "label":
        choices = await suggestLabels(env, query);
        break;
      case "milestone":
        choices = await suggestMilestones(env, query);
        break;
      case "week":
        choices = suggestWeeks(query);
        break;
      case "range":
        choices = suggestRanges(query);
        break;
    }
  } catch (err) {
    // Expose the error as a single disabled-looking choice so it's visible in Discord
    const msg = String(err).slice(0, 90);
    console.error(`Autocomplete error [${name}]:`, err);
    choices = [{ name: `⚠️ Error: ${msg}`, value: "__error__" }];
  }

  return Response.json({ type: 8, data: { choices } });
}
