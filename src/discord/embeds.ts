import type { ChangelogData, ChangelogFormat } from "../types";

const COLORS = {
  success: 0x2ecc71,
  info: 0x3498db,
  warning: 0xe67e22,
  empty: 0x95a5a6,
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FORMAT_META: Record<ChangelogFormat, { icon: string; label: string; color: number }> = {
  changelog: { icon: "✨", label: "AI Summary",        color: 0x2ecc71 },
  "pr":      { icon: "🔧", label: "PR Release Notes",  color: 0x3498db },
  "press-release": { icon: "📣", label: "Press Release", color: 0x9b59b6 },
};

export function buildChangelogEmbed(data: ChangelogData, format: ChangelogFormat = "changelog"): object {
  const { user, mergedMRs, aiSummary, weekStart, weekEnd } = data;
  const hasActivity = mergedMRs.length > 0;
  const meta = FORMAT_META[format];

  // Group MRs by project
  const byProject = new Map<string, typeof mergedMRs>();
  for (const mr of mergedMRs) {
    const list = byProject.get(mr.projectName) ?? [];
    list.push(mr);
    byProject.set(mr.projectName, list);
  }

  const fields: object[] = [];

  if (hasActivity) {
    // MRs per project (max 5 projects to stay within Discord limits)
    let projectCount = 0;
    for (const [projectName, mrs] of byProject) {
      if (projectCount >= 5) break;

      const mrLines = mrs
        .slice(0, 5)
        .map((mr) => `• [${truncate(mr.title, 60)}](${mr.web_url})`)
        .join("\n");

      fields.push({
        name: `📁 ${projectName}`,
        value: truncate(mrLines, 1024),
        inline: false,
      });

      projectCount++;
    }

    // AI summary field
    fields.push({
      name: `${meta.icon} ${meta.label}`,
      value: truncate(aiSummary, 1024),
      inline: false,
    });

    // Stats footer field
    const totalCommits = mergedMRs.reduce((sum, mr) => sum + mr.commits.length, 0);
    fields.push({
      name: "📊 Stats",
      value: `**${mergedMRs.length}** MRs merged · **${totalCommits}** commits`,
      inline: true,
    });
  }

  return {
    embeds: [
      {
        title: `📋 ${user.gitlabUsername}'s Weekly Changelog`,
        description: hasActivity
          ? `Week of **${formatDate(weekStart)}** → **${formatDate(weekEnd)}**`
          : `No activity found for the week of **${formatDate(weekStart)}** → **${formatDate(weekEnd)}**.`,
        color: hasActivity ? meta.color : COLORS.empty,
        fields,
        footer: {
          text: "GitLab Changelog Bot",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function buildErrorEmbed(message: string): object {
  return {
    embeds: [
      {
        title: "❌ Error",
        description: message,
        color: 0xe74c3c,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function buildSuccessEmbed(title: string, description: string): object {
  return {
    embeds: [
      {
        title: `✅ ${title}`,
        description,
        color: COLORS.success,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function buildUserListEmbed(
  users: { discordUsername: string; gitlabUsername: string }[]
): object {
  const description =
    users.length === 0
      ? "No users registered yet. Use `/changelog register` to add team members."
      : users
          .map((u) => `• **${u.discordUsername}** → \`${u.gitlabUsername}\` (GitLab)`)
          .join("\n");

  return {
    embeds: [
      {
        title: "👥 Registered Team Members",
        description,
        color: COLORS.info,
        footer: { text: `${users.length} member${users.length !== 1 ? "s" : ""} registered` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
