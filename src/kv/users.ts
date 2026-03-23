/**
 * Thin KV layer for the Discord ↔ GitLab username mapping.
 *
 * This is the ONLY thing we store. Everything else (who's in the org,
 * what teams exist, what projects exist) comes directly from GitLab.
 *
 * Schema:
 *   discord:{discordId}  → gitlabUsername   (primary lookup)
 *   gitlab:{username}    → discordId        (reverse lookup)
 *   users:all            → JSON array of UserMapping (for list command)
 */

import type { UserMapping } from "../types";

// ─── Write ────────────────────────────────────────────────────────────────────

export async function registerUser(kv: KVNamespace, mapping: UserMapping): Promise<void> {
  await Promise.all([
    kv.put(`discord:${mapping.discordId}`, mapping.gitlabUsername),
    kv.put(`gitlab:${mapping.gitlabUsername}`, mapping.discordId),
  ]);

  // Update the full list
  const existing = await getAllMappings(kv);
  const others = existing.filter((u) => u.discordId !== mapping.discordId);
  await kv.put("users:all", JSON.stringify([...others, mapping]));
}

export async function unregisterUser(kv: KVNamespace, discordId: string): Promise<void> {
  const gitlabUsername = await kv.get(`discord:${discordId}`);
  const ops: Promise<void>[] = [kv.delete(`discord:${discordId}`)];
  if (gitlabUsername) ops.push(kv.delete(`gitlab:${gitlabUsername}`));

  const existing = await getAllMappings(kv);
  ops.push(kv.put("users:all", JSON.stringify(existing.filter((u) => u.discordId !== discordId))));

  await Promise.all(ops);
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getGitlabUsername(kv: KVNamespace, discordId: string): Promise<string | null> {
  return kv.get(`discord:${discordId}`);
}

export async function getDiscordId(kv: KVNamespace, gitlabUsername: string): Promise<string | null> {
  return kv.get(`gitlab:${gitlabUsername}`);
}

export async function getAllMappings(kv: KVNamespace): Promise<UserMapping[]> {
  const raw = await kv.get("users:all");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UserMapping[];
  } catch {
    return [];
  }
}
