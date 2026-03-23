import type { ChangelogData, DigestMode, EnrichedMR, ReleaseData } from "../types";

const MODEL = "@cf/zai-org/glm-4.7-flash";

// ─── MR context builder ──────────────────────────────────────────────────────

function buildMRContext(mrs: EnrichedMR[]): string {
  return mrs.map((mr) => {
    // Show real line counts if available (deletions > 0), else file count
    const diff = mr.diffStats
      ? mr.diffStats.deletions > 0
        ? ` (+${mr.diffStats.additions} lines / -${mr.diffStats.deletions} lines)`
        : ` (${mr.diffStats.additions} files changed)`
      : "";
    const labels = mr.labels.length ? ` [${mr.labels.join(", ")}]` : "";
    const milestone = mr.milestone ? ` | milestone: ${mr.milestone.title}` : "";
    return (
      `MR: ${mr.title}${diff}${labels}${milestone}\n` +
      `  Project: ${mr.projectName} | Author: ${mr.author.name}\n` +
      `  Branch: ${mr.source_branch} → ${mr.target_branch}\n` +
      (mr.description ? `  Description: ${mr.description.slice(0, 300)}\n` : "")
    );
  }).join("\n");
}

function buildBlockerContext(data: ChangelogData): string {
  const parts: string[] = [];
  if (data.staleMRs.length > 0) {
    parts.push("STALE / BLOCKED MRs:");
    for (const mr of data.staleMRs.slice(0, 5)) {
      parts.push(`  - "${mr.title}" (${mr.staleDays}d stale, ${mr.reason}) — ${mr.projectName}`);
    }
  }
  if (data.openMRs.length > 0) {
    parts.push("OPEN / IN-PROGRESS MRs:");
    for (const mr of data.openMRs.slice(0, 5)) {
      parts.push(`  - "${mr.title}" — ${mr.projectName} (${mr.source_branch})`);
    }
  }
  if (data.reviewActivity && data.reviewActivity.reviewsGiven > 0) {
    parts.push(`REVIEW ACTIVITY: ${data.reviewActivity.reviewsGiven} reviews given, ${data.reviewActivity.approvals} approvals, ${data.reviewActivity.commentsLeft} comments`);
  }
  return parts.join("\n");
}

// ─── Prompt factory (all 8 modes) ────────────────────────────────────────────

function buildPrompt(data: ChangelogData, mode: DigestMode): { system: string; user: string } {
  const context = buildMRContext(data.mergedMRs);
  const blockers = buildBlockerContext(data);
  const who = data.scope.type === "user"
    ? `**${data.displayName}**`
    : `**${data.displayName}** (${data.scope.type}: ${data.scope.value})`;
  const dateLabel = data.dateRange.label;
  const fullContext = [context, blockers].filter(Boolean).join("\n\n---\n\n");

  if (data.mergedMRs.length === 0 && data.openMRs.length === 0) {
    return {
      system: "You are a concise technical writer.",
      user: `${who} had no merged MR activity for ${dateLabel}. ${data.staleMRs.length > 0 ? `They have ${data.staleMRs.length} stale open MR(s).` : ""} Write one sentence.`,
    };
  }

  switch (mode) {
    case "pr":
      return {
        system: "You are a senior engineer writing internal PR release notes. Be technical, precise, use bullet points grouped by project/theme. Past tense. No fluff.",
        user: `Write **PR release notes** for ${who} (${dateLabel}).\n- Bullet points grouped by project.\n- Note diff sizes for large changes (>200 lines).\n- Include blockers/risk if present.\n\n${fullContext}`,
      };

    case "press-release":
      return {
        system: "You are a product marketing manager writing external-facing announcements. Clear, exciting, non-technical. Focus on user/business impact.",
        user: `Write a **press release** (2–3 sentences) for ${who}'s work (${dateLabel}). Frame around what users gain. Present tense.\n\n${fullContext}`,
      };

    case "release-notes":
      return {
        system: "You are a product manager writing structured release notes. Group by: ## Features, ## Improvements, ## Fixes, ## Breaking Changes. Skip empty sections.",
        user: `Write **structured release notes** for ${who} (${dateLabel}). One bullet per item, one sentence each.\n\n${fullContext}`,
      };

    case "concise":
      return {
        system: "You are a busy engineering manager. Write a TL;DR.",
        user: `Write a **2-sentence TL;DR** for ${who}'s work (${dateLabel}). Mention total MRs. If there are blockers, mention the most critical one.\n\n${fullContext}`,
      };

    case "manager":
      return {
        system: "You are an engineering manager writing a weekly summary for leadership. Focus on: impact, cross-team dependencies, blockers, risks, and follow-up items. Be structured and clear.",
        user: `Write a **manager-level summary** for ${who} (${dateLabel}) with these sections:\n## What Shipped\n## Key Impact\n## Blockers & Risks\n## Follow-up Needed\n\nSkip empty sections. Be concrete — link themes to business context.\n\n${fullContext}`,
      };

    case "engineering":
      return {
        system: "You are a senior staff engineer writing a detailed technical summary. Include architecture implications, notable patterns, and technical debt signals. Be specific about what changed and why.",
        user: `Write a **deep technical summary** for ${who} (${dateLabel}).\n- Group by system area or project.\n- Note architectural changes, new patterns, refactors.\n- Flag potential tech debt.\n- Mention review activity if present.\n\n${fullContext}`,
      };

    case "executive":
      return {
        system: "You are a VP of Engineering writing a high-level summary for C-suite. Focus exclusively on business impact, strategic alignment, and risk. No technical jargon. 2–3 sentences max.",
        user: `Write an **executive summary** (2–3 sentences) for ${who} (${dateLabel}). What moved the needle for the business? Any risks?\n\n${fullContext}`,
      };

    case "changelog":
    default:
      return {
        system: "You are a technical changelog writer. Write clear, professional summaries with structure.",
        user: `Write a **changelog** for ${who} (${dateLabel}) with these sections:\n## What Shipped\nProse summary (2–3 sentences) of what was delivered and its impact.\n## Notable Changes\nBullet points of the most significant MRs (max 5).\n## Blockers\nAny stale MRs or items needing attention (or "None").\n\n${fullContext}`,
      };
  }
}

// ─── Deterministic fallback for low-quality input ─────────────────────────────

function buildDeterministicSummary(data: ChangelogData): string {
  const { mergedMRs, staleMRs, openMRs } = data;
  const projects = [...new Set(mergedMRs.map((mr) => mr.projectName))];
  let totalFiles = 0;
  for (const mr of mergedMRs) {
    if (mr.diffStats) totalFiles += mr.diffStats.additions;
  }

  const lines: (string | null)[] = [
    `**${mergedMRs.length}** MR${mergedMRs.length !== 1 ? "s" : ""} merged` +
    (projects.length > 1 ? ` across **${projects.length}** projects` : ` in **${projects[0] ?? "unknown"}**`),
    totalFiles > 0 ? `**${totalFiles}** files changed` : null,
    "",
    "**Top changes:**",
    ...mergedMRs.slice(0, 5).map((mr) => `• [${mr.title}](${mr.web_url})`),
  ];

  if (staleMRs.length > 0) lines.push("", `**⚠️ ${staleMRs.length} stale MR(s)** needing attention`);
  if (openMRs.length > 0) lines.push("", `**🔄 ${openMRs.length} open MR(s)** in progress`);

  return lines.filter((l) => l !== null).join("\n");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAISummary(
  ai: Ai,
  data: ChangelogData,
  mode: DigestMode = "changelog"
): Promise<string> {
  // Confidence gate: only skip AI for truly low quality (all garbage titles, no content)
  if (data.inputQuality === "low" && data.mergedMRs.length > 0) {
    return buildDeterministicSummary(data);
  }
  // For medium/high quality, always attempt AI (MR titles alone are enough context)

  const { system, user } = buildPrompt(data, mode);

  try {
    const response = (await (ai as Ai).run(MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })) as { choices?: { message?: { content?: string | null } }[] };

    const text = response?.choices?.[0]?.message?.content?.trim();
    if (!text) return buildDeterministicSummary(data);
    return text;
  } catch (err) {
    console.error("AI summarize error:", err);
    return buildDeterministicSummary(data);
  }
}

// ─── Release notes AI summary ─────────────────────────────────────────────────

export async function generateReleaseSummary(ai: Ai, release: ReleaseData): Promise<string> {
  const sections: string[] = [];
  if (release.features.length) sections.push(`Features (${release.features.length}):\n${buildMRContext(release.features)}`);
  if (release.fixes.length) sections.push(`Fixes (${release.fixes.length}):\n${buildMRContext(release.fixes)}`);
  if (release.improvements.length) sections.push(`Improvements (${release.improvements.length}):\n${buildMRContext(release.improvements)}`);
  if (release.breaking.length) sections.push(`Breaking Changes (${release.breaking.length}):\n${buildMRContext(release.breaking)}`);

  const prompt = {
    system: "You are writing structured release notes for a software product. Be clear, user-focused, and group by: ## Features, ## Bug Fixes, ## Improvements, ## Breaking Changes. Skip empty sections.",
    user: `Write release notes for **${release.label}**.\n\n${sections.join("\n\n")}`,
  };

  try {
    const response = (await (ai as Ai).run(MODEL as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    })) as { choices?: { message?: { content?: string | null } }[] };

    return response?.choices?.[0]?.message?.content?.trim() ?? "Release summary unavailable.";
  } catch {
    return "Release summary unavailable.";
  }
}
