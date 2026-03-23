/**
 * Discord thread utilities.
 *
 * Thread mode flow:
 *   1. POST parent summary embed → channel  (team overview)
 *   2. POST /messages/{id}/threads          → creates a public thread
 *   3. POST individual embeds → thread channel
 *
 * Discord API refs:
 *   - Create thread from message: POST /channels/{channel_id}/messages/{message_id}/threads
 *   - Send to thread: POST /channels/{thread_id}/messages  (same as any channel)
 */

import type { ChangelogData } from "../types";
import { buildChangelogEmbed, buildThreadParentEmbed } from "./embeds";
import type { DigestMode } from "../types";

const API = "https://discord.com/api/v10";

// ─── Low-level helpers ─────────────────────────────────────────────────────────

async function discordPost(
  path: string,
  body: object,
  botToken: string
): Promise<{ id: string }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ id: string }>;
}

// ─── Create a public thread on an existing message ─────────────────────────────

export async function createThreadOnMessage(
  channelId: string,
  messageId: string,
  name: string,
  botToken: string
): Promise<string> {
  const thread = await discordPost(
    `/channels/${channelId}/messages/${messageId}/threads`,
    {
      name: name.slice(0, 100),   // Discord thread name max 100 chars
      auto_archive_duration: 1440, // archive after 24h of inactivity
    },
    botToken
  );
  return thread.id;
}

// ─── Post a message to a channel / thread ─────────────────────────────────────

export async function postMessage(
  channelId: string,
  body: object,
  botToken: string
): Promise<string> {
  const msg = await discordPost(`/channels/${channelId}/messages`, body, botToken);
  return msg.id;
}

// ─── Full threaded digest ──────────────────────────────────────────────────────

export interface ThreadedDigestOptions {
  channelId: string;
  botToken: string;
  changelogs: ChangelogData[];
  mode: DigestMode;
  periodLabel: string;        // e.g. "2026-W12 · Mar 16 – Mar 22, 2026"
  teamName?: string;
}

export async function postThreadedDigest(opts: ThreadedDigestOptions): Promise<{
  parentMessageId: string;
  threadId: string;
  posted: number;
  skipped: number;
}> {
  const { channelId, botToken, changelogs, mode, periodLabel, teamName } = opts;

  // 1. Build and post parent summary message
  const active = changelogs.filter(
    (d) => d.mergedMRs.length > 0 || d.staleMRs.length > 0 || d.openMRs.length > 0
  );
  const parentEmbed = buildThreadParentEmbed(active, periodLabel, teamName);
  const parentId = await postMessage(channelId, parentEmbed, botToken);

  // 2. Create thread on the parent message
  const threadName = teamName
    ? `${teamName} — ${periodLabel}`
    : `Changelogs — ${periodLabel}`;
  const threadId = await createThreadOnMessage(channelId, parentId, threadName, botToken);

  // 3. Post each member's changelog into the thread
  let posted = 0;
  let skipped = 0;

  for (const data of changelogs) {
    // Skip members with zero activity to keep the thread clean
    if (data.mergedMRs.length === 0 && data.staleMRs.length === 0 && data.openMRs.length === 0) {
      skipped++;
      continue;
    }

    try {
      await postMessage(threadId, buildChangelogEmbed(data), botToken);
      posted++;
    } catch (err) {
      console.error(`Thread post failed for ${data.gitlabUsername}:`, err);
      skipped++;
    }
  }

  return { parentMessageId: parentId, threadId, posted, skipped };
}
