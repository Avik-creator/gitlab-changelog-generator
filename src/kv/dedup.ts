/**
 * Deduplication of weekly digest posts.
 *
 * Prevents the weekly cron from double-posting if it somehow fires twice,
 * and lets /changelog re-run force a re-post.
 *
 * Key: dedup:{isoWeek}:{gitlabUsername}  → "1"
 * TTL: 8 days (slightly longer than a week)
 */

const TTL = 60 * 60 * 24 * 8; // 8 days in seconds

export async function markPosted(
  kv: KVNamespace,
  isoWeek: string,
  username: string
): Promise<void> {
  await kv.put(`dedup:${isoWeek}:${username}`, "1", { expirationTtl: TTL });
}

export async function wasPosted(
  kv: KVNamespace,
  isoWeek: string,
  username: string
): Promise<boolean> {
  const val = await kv.get(`dedup:${isoWeek}:${username}`);
  return val === "1";
}

export async function clearPosted(
  kv: KVNamespace,
  isoWeek: string,
  username: string
): Promise<void> {
  await kv.delete(`dedup:${isoWeek}:${username}`);
}
