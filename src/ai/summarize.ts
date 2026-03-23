import type { Ai } from "@cloudflare/workers-types";
import type { ChangelogData, ChangelogFormat } from "../types";

const MODEL = "@cf/zai-org/glm-4.7-flash";

function buildMRContext(data: ChangelogData): string {
  const { user, mergedMRs, weekStart, weekEnd } = data;
  const weekRange = `${weekStart.toDateString()} – ${weekEnd.toDateString()}`;

  if (mergedMRs.length === 0) {
    return `Engineer: ${user.gitlabUsername}\nWeek: ${weekRange}\nNo merged activity this week.`;
  }

  const mrSummaries = mergedMRs
    .map((mr) => {
      const commitTitles = mr.commits
        .slice(0, 5)
        .map((c) => `    - ${c.title}`)
        .join("\n");
      return `MR: "${mr.title}" (${mr.projectName})\nDescription: ${mr.description?.slice(0, 300) ?? "N/A"}\nCommits:\n${commitTitles || "    - (none listed)"}`;
    })
    .join("\n\n");

  return `Engineer: ${user.gitlabUsername}\nWeek: ${weekRange}\n\n${mrSummaries}`;
}

function buildPrompt(data: ChangelogData, format: ChangelogFormat): { system: string; user: string } {
  const context = buildMRContext(data);
  const { mergedMRs } = data;

  if (mergedMRs.length === 0) {
    return {
      system: "You are a concise technical writer.",
      user: `Write a single friendly sentence noting that ${data.user.gitlabUsername} had no merged activity this week.`,
    };
  }

  switch (format) {
    case "pr":
      return {
        system:
          "You are a senior engineer writing internal PR release notes. Be technical, precise, and use bullet points. Group by theme. Use past tense.",
        user: `Write a **PR-style release notes** summary for this engineer's work. Use markdown bullet points grouped by project or theme. Include technical details like what changed and why. No fluff.\n\n${context}`,
      };

    case "press-release":
      return {
        system:
          "You are a product marketing manager writing external-facing release announcements. Be clear, exciting, and non-technical. Focus on user impact and business value. No jargon.",
        user: `Write a **press release style** paragraph (2–3 sentences) announcing this engineer's work as a product update. Frame it around what users or the business gains — not how it was built. Use present tense, e.g. "SuperAlign now supports...".\n\n${context}`,
      };

    case "changelog":
    default:
      return {
        system:
          "You are a concise technical changelog writer. Write clear, professional summaries of engineering work.",
        user: `Write a **changelog summary** in 2–3 sentences of professional prose. Focus on what was shipped and its impact. Do not list every MR — synthesize the theme. No headers or bullets.\n\n${context}`,
      };
  }
}

export async function generateAISummary(
  ai: Ai,
  data: ChangelogData,
  format: ChangelogFormat = "changelog"
): Promise<string> {
  try {
    const { system, user } = buildPrompt(data, format);

    const response = await (ai as Ai).run(MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }) as { choices?: { message?: { content?: string | null } }[] };

    return response?.choices?.[0]?.message?.content?.trim() ?? "AI summary unavailable.";
  } catch (err) {
    console.error("AI summarization failed:", err);
    return "AI summary could not be generated.";
  }
}
