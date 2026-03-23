/**
 * Named sub-team management in KV.
 *
 * Supports:
 *   /changelog team create name:platform members:alice,bob,charlie channel:#changelog-platform
 *   /changelog team list
 *   /changelog team delete name:platform
 *   /changelog generate team:platform
 */

export interface TeamConfig {
  name: string;
  members: string[];       // GitLab usernames
  channelId?: string;      // Discord channel ID for auto-posts (optional)
  createdAt: string;       // ISO timestamp
  updatedAt: string;
}

const PREFIX = "team:";

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getTeam(kv: KVNamespace, name: string): Promise<TeamConfig | null> {
  const raw = await kv.get(`${PREFIX}${name.toLowerCase()}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as TeamConfig; } catch { return null; }
}

export async function saveTeam(kv: KVNamespace, config: TeamConfig): Promise<void> {
  await kv.put(`${PREFIX}${config.name.toLowerCase()}`, JSON.stringify(config));
}

export async function deleteTeam(kv: KVNamespace, name: string): Promise<boolean> {
  const existing = await getTeam(kv, name);
  if (!existing) return false;
  await kv.delete(`${PREFIX}${name.toLowerCase()}`);
  return true;
}

export async function listTeams(kv: KVNamespace): Promise<TeamConfig[]> {
  const list = await kv.list({ prefix: PREFIX });
  const results: TeamConfig[] = [];
  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      try { results.push(JSON.parse(raw) as TeamConfig); } catch { /* skip */ }
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Team index key (for O(1) listing without full KV scan in small sets) ─────

export async function upsertTeam(
  kv: KVNamespace,
  name: string,
  members: string[],
  channelId?: string
): Promise<TeamConfig> {
  const existing = await getTeam(kv, name);
  const config: TeamConfig = {
    name: name.toLowerCase(),
    members,
    channelId: channelId ?? existing?.channelId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveTeam(kv, config);
  return config;
}
