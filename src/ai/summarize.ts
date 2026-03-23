import type { ChangelogData, ChangelogFormat, EnrichedMR } from "../types";

const MODEL = "@cf/zai-org/glm-4.7-flash";

// ─── Context builder ──────────────────────────────────────────────────────────

function buildMRContext(data: ChangelogData): string {
  return data.mergedMRs.map((mr) => {
    const diff = mr.diffStats ? ` (+${mr.diffStats.additions}/-${mr.diffStats.deletions})` : "";
    const labels = mr.labels.length ? ` [${mr.labels.join(", ")}]` : "";
    const milestone = mr.milestone ? ` | milestone: ${mr.milestone.title}` : "";
    const commits = mr.commits
      .slice(0, 5)
      .map((c) => `    - ${c.title}`)
      .join("\n");

    return (
      `MR: ${mr.title}${diff}${labels}${milestone}\n` +
      `  Project: ${mr.projectName}\n` +
      `  Branch: ${mr.source_branch} → ${mr.target_branch}\n` +
      (commits ? `  Commits:\n${commits}\n` : "") +
      (mr.description ? `  Description: ${mr.description.slice(0, 200)}\n` : "")
    );
  }).join("\n");
}

// ─── Prompt factory ───────────────────────────────────────────────────────────

function buildPrompt(data: ChangelogData, format: ChangelogFormat): { system: string; user: string } {
  const context = buildMRContext(data);
  const who = `**${data.displayName}**`;

  if (data.mergedMRs.length === 0) {
    return {
      system: "You are a concise technical writer.",
      user: `Write a single friendly sentence noting that ${who} had no merged MR activity this week.`,
    };
  }

  switch (format) {
    case "pr":
      return {
        system: "You are a senior engineer writing internal PR release notes. Be technical, precise, use bullet points. Group by project or theme. Use past tense.",
        user: `Write **PR-style release notes** for ${who}'s work this week.\n- Use markdown bullet points grouped by project/theme.\n- Include technical details: what changed, affected areas.\n- Note diff sizes for large changes (>200 lines).\n- No fluff.\n\n${context}`,
      };

    case "press-release":
      return {
        system: "You are a product marketing manager writing external-facing release announcements. Be clear, exciting, non-technical. Focus on user impact and business value.",
        user: `Write a **press release** (2–3 sentences) for ${who}'s work this week.\n- Frame around what users/business gains, not how it was built.\n- Use present tense, e.g. "SuperAlign now supports...".\n\n${context}`,
      };

    case "release-notes":
      return {
        system: "You are a product manager writing structured release notes. Group by type: Features, Improvements, Fixes.",
        user: `Write **structured release notes** for ${who}'s work this week.\n- Use headers: ## Features, ## Improvements, ## Fixes (skip empty sections).\n- One bullet per item, one sentence each.\n\n${context}`,
      };

    case "concise":
      return {
        system: "You are a busy engineering manager. Write a one-paragraph TL;DR.",
        user: `Write a **2-sentence TL;DR** for ${who}'s week. Focus on the most impactful change. Mention total MRs shipped.\n\n${context}`,
      };

    case "changelog":
    default:
      return {
        system: "You are a concise technical changelog writer. Write clear, professional summaries of engineering work.",
        user: `Write a **changelog summary** in 2–3 sentences for ${who}'s week.\n- Focus on what shipped and its impact.\n- Synthesize the theme — don't list every MR.\n- Reference labels or milestones if they add context.\n- No headers or bullets.\n\n${context}`,
      };
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function generateAISummary(
  ai: Ai,
  data: ChangelogData,
  format: ChangelogFormat = "changelog"
): Promise<string> {
  const { system, user } = buildPrompt(data, format);

  try {
    const response = (await (ai as Ai).run(MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })) as { choices?: { message?: { content?: string | null } }[] };

    return response?.choices?.[0]?.message?.content?.trim() ?? "AI summary unavailable.";
  } catch (err) {
    console.error("AI summarize error:", err);
    return "AI summary unavailable.";
  }
}
