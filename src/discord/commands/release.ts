import type { Env, DiscordCommandOption, ReleaseData, EnrichedMR } from "../../types";
import { GitLabClient } from "../../gitlab/client";
import { applyFilters } from "../../gitlab/filters";
import { generateReleaseSummary } from "../../ai/summarize";
import { buildReleaseEmbed, buildErrorEmbed } from "../embeds";
import { getGlobalConfig, resolveFilters } from "../../kv/config";
import { DEFAULT_FILTERS } from "../../types";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function postToChannel(channelId: string, body: object, botToken: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Classify MRs into release categories based on labels and title patterns.
 */
function classifyMRs(mrs: EnrichedMR[]): {
  features: EnrichedMR[]; fixes: EnrichedMR[];
  improvements: EnrichedMR[]; breaking: EnrichedMR[]; internal: EnrichedMR[];
} {
  const features: EnrichedMR[] = [];
  const fixes: EnrichedMR[] = [];
  const improvements: EnrichedMR[] = [];
  const breaking: EnrichedMR[] = [];
  const internal: EnrichedMR[] = [];

  const featurePatterns = [/\bfeature\b/i, /\bfeat[:(]/i, /\bnew\b/i];
  const fixPatterns = [/\bfix\b/i, /\bbug\b/i, /\bhotfix\b/i, /\bpatch\b/i];
  const breakingPatterns = [/\bbreaking\b/i, /\bBREAKING CHANGE\b/];
  const internalPatterns = [/\bchore\b/i, /\bci\b/i, /\binfra\b/i, /\binternal\b/i, /\brefactor\b/i];

  for (const mr of mrs) {
    const text = `${mr.title} ${mr.labels.join(" ")}`;

    if (breakingPatterns.some((p) => p.test(text))) { breaking.push(mr); continue; }
    if (fixPatterns.some((p) => p.test(text))) { fixes.push(mr); continue; }
    if (featurePatterns.some((p) => p.test(text))) { features.push(mr); continue; }
    if (internalPatterns.some((p) => p.test(text))) { internal.push(mr); continue; }
    improvements.push(mr);
  }

  return { features, fixes, improvements, breaking, internal };
}

export async function handleRelease(
  appId: string, token: string, options: DiscordCommandOption[], env: Env
): Promise<void> {
  const milestoneOpt = getOpt(options, "milestone");
  const projectOpt   = getOpt(options, "project");

  if (!milestoneOpt) {
    await patch(appId, token, buildErrorEmbed("Missing milestone", "Usage: `/release generate milestone:v2.4` [project:billing-service]"));
    return;
  }

  try {
    const client = new GitLabClient(env.GITLAB_BASE_URL, env.GITLAB_TOKEN);
    const globalConfig = await getGlobalConfig(env.USERS_KV);
    const filters = resolveFilters(globalConfig);

    let rawMRs = await client.getMergedMRsByMilestone(env.GITLAB_GROUP_ID, milestoneOpt);

    // Optional: filter to a specific project
    if (projectOpt) {
      const project = await client.findProjectByPath(projectOpt);
      if (project) {
        rawMRs = rawMRs.filter((mr) => mr.project_id === project.id);
      }
    }

    const enriched = await client.enrichMRs(rawMRs);
    const { passed } = applyFilters(enriched, filters);
    const classified = classifyMRs(passed);

    const release: ReleaseData = {
      scope: { type: "milestone", milestone: milestoneOpt },
      label: milestoneOpt,
      ...classified,
      aiSummary: "",
    };

    release.aiSummary = await generateReleaseSummary(env.AI, release);
    const embed = buildReleaseEmbed(release);

    await postToChannel(env.DISCORD_CHANGELOG_CHANNEL_ID, embed, env.DISCORD_BOT_TOKEN);
    await patch(appId, token, { content: `✅ Release notes for **${milestoneOpt}** posted.` });

  } catch (err) {
    console.error("handleRelease error:", err);
    await patch(appId, token, buildErrorEmbed("Release failed", `\`\`\`\n${String(err).slice(0, 400)}\n\`\`\``));
  }
}
