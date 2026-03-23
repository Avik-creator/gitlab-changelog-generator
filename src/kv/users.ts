import type { UserMapping } from "../types";

const ALL_USERS_KEY = "users:all";

function userKey(discordId: string): string {
  return `discord:${discordId}`;
}

export async function registerUser(
  kv: KVNamespace,
  discordId: string,
  discordUsername: string,
  gitlabUsername: string
): Promise<void> {
  const mapping: UserMapping = { discordId, discordUsername, gitlabUsername };
  await kv.put(userKey(discordId), JSON.stringify(mapping));

  // Maintain a list of all registered discord IDs
  const existing = await getAllUserIds(kv);
  if (!existing.includes(discordId)) {
    existing.push(discordId);
    await kv.put(ALL_USERS_KEY, JSON.stringify(existing));
  }
}

export async function getUser(
  kv: KVNamespace,
  discordId: string
): Promise<UserMapping | null> {
  const raw = await kv.get(userKey(discordId));
  if (!raw) return null;
  return JSON.parse(raw) as UserMapping;
}

export async function getUserByGitlab(
  kv: KVNamespace,
  gitlabUsername: string
): Promise<UserMapping | null> {
  const all = await getAllUsers(kv);
  return all.find((u) => u.gitlabUsername === gitlabUsername) ?? null;
}

export async function getAllUsers(kv: KVNamespace): Promise<UserMapping[]> {
  const ids = await getAllUserIds(kv);
  if (ids.length === 0) return [];

  const users = await Promise.all(ids.map((id) => getUser(kv, id)));
  return users.filter((u): u is UserMapping => u !== null);
}

async function getAllUserIds(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(ALL_USERS_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as string[];
}

export async function removeUser(kv: KVNamespace, discordId: string): Promise<void> {
  await kv.delete(userKey(discordId));
  const ids = await getAllUserIds(kv);
  await kv.put(ALL_USERS_KEY, JSON.stringify(ids.filter((id) => id !== discordId)));
}
