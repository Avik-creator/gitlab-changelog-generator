import type { Env } from "../../types";
import { getAllMappings } from "../../kv/users";
import { GitLabClient } from "../../gitlab/client";
import { buildHealthEmbed, buildErrorEmbed } from "../embeds";

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function handleHealth(appId: string, token: string, env: Env): Promise<void> {
  try {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);

    let gitlabOk = false;
    let gitlabMemberCount = 0;
    try {
      const members = await client.getGroupMembers(env.GITLAB_GROUP_ID);
      gitlabMemberCount = members.length;
      gitlabOk = true;
    } catch { /* fall through */ }

    let aiOk = false;
    try {
      const res = await (env.AI as Ai).run(
        "@cf/meta/llama-3.1-8b-instruct" as Parameters<Ai["run"]>[0],
        { messages: [{ role: "user", content: "ping" }] }
      ) as { choices?: unknown[] };
      aiOk = Array.isArray(res?.choices);
    } catch { /* fall through */ }

    const mappings = await getAllMappings(env.USERS_KV).catch(() => []);

    await patch(appId, token, buildHealthEmbed({
      mappingCount: mappings.length,
      gitlabMemberCount,
      gitlabOk,
      aiOk,
    }));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Health check failed", String(err)));
  }
}
