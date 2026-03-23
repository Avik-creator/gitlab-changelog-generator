/**
 * Lightweight KV cache for per-user periodic stats.
 *
 * Keys
 *   stats:{periodKey}:{gitlabUsername}  →  serialised UserStats
 *
 * Period key examples
 *   "2026-W12"   (ISO week)
 *   "2026-03"    (calendar month)
 *   "7d:2026-03-22"   (rolling 7-day anchored at date)
 *
 * TTL: 7 days — stale enough after a new week that we don't want to serve it.
 */

import type { KVNamespace } from "@cloudflare/workers-types";
import type { UserStats } from "../types";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Derive a compact, stable period key from a DateRange label or ISO week.
export function periodKey(label: string): string {
  return label.replace(/[^a-z0-9-]/gi, "_").slice(0, 40);
}

export async function cacheStats(
  kv: KVNamespace,
  period: string,
  stats: UserStats
): Promise<void> {
  const key = `stats:${periodKey(period)}:${stats.username}`;
  await kv.put(key, JSON.stringify(stats), { expirationTtl: TTL_SECONDS });
}

export async function getCachedStats(
  kv: KVNamespace,
  period: string,
  gitlabUsername: string
): Promise<UserStats | null> {
  const key = `stats:${periodKey(period)}:${gitlabUsername}`;
  const raw = await kv.get(key);
  return raw ? (JSON.parse(raw) as UserStats) : null;
}

export async function getOrComputeStats(
  kv: KVNamespace,
  period: string,
  gitlabUsername: string,
  compute: () => Promise<UserStats>
): Promise<UserStats> {
  const cached = await getCachedStats(kv, period, gitlabUsername);
  if (cached) return cached;
  const fresh = await compute();
  await cacheStats(kv, period, fresh);
  return fresh;
}
