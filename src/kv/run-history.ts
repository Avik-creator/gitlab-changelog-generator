/**
 * Tracks the last weekly cron run for observability.
 * Exposed via /changelog last-run.
 */

export interface RunRecord {
  triggeredAt: string;    // ISO timestamp
  triggerType: "cron" | "manual";
  durationMs: number;
  membersProcessed: number;
  posted: number;         // successfully posted
  failed: number;
  skipped: number;        // deduped / already posted
  errors: string[];       // first N error messages
}

const KEY = "lastrun:weekly";

export async function saveRunRecord(kv: KVNamespace, record: RunRecord): Promise<void> {
  await kv.put(KEY, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 30 }); // 30d
}

export async function getRunRecord(kv: KVNamespace): Promise<RunRecord | null> {
  const raw = await kv.get(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as RunRecord; } catch { return null; }
}
