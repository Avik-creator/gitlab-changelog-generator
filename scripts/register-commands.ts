/**
 * Register Discord slash commands.
 * Run: bun run register-commands
 */
export {};

const APP_ID    = process.env.DISCORD_APPLICATION_ID!;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}

const MODE_CHOICES = [
  { name: "✨ Changelog — professional prose",       value: "changelog" },
  { name: "🔧 PR Notes — technical bullets",         value: "pr" },
  { name: "📣 Press Release — stakeholder summary",  value: "press-release" },
  { name: "📝 Release Notes — Features/Fixes",       value: "release-notes" },
  { name: "⚡ Concise — 2-sentence TL;DR",           value: "concise" },
  { name: "📊 Manager — impact + blockers + risks",  value: "manager" },
  { name: "🏗️ Engineering — deep technical detail",  value: "engineering" },
  { name: "🎯 Executive — business impact only",     value: "executive" },
];

const commands = [
  {
    name: "changelog",
    description: "GitLab Changelog Bot",
    options: [

      // ── /changelog generate ────────────────────────────────────────────────
      {
        name: "generate",
        description: "Generate a changelog for a user, project, label, milestone, or everyone",
        type: 1,
        options: [
          {
            name: "user",
            description: "Discord user to generate for (default: you)",
            type: 6,          // USER — built-in Discord user picker
            required: false,
          },
          {
            name: "gitlab",
            description: "GitLab username — type to search group members",
            type: 3,
            required: false,
            autocomplete: true,   // ← live suggestions from GitLab
          },
          {
            name: "project",
            description: "Project path — type to search group projects",
            type: 3,
            required: false,
            autocomplete: true,   // ← live suggestions from GitLab
          },
          {
            name: "label",
            description: "Label name — type to search group labels",
            type: 3,
            required: false,
            autocomplete: true,   // ← live suggestions from GitLab
          },
          {
            name: "milestone",
            description: "Milestone title — type to search group milestones",
            type: 3,
            required: false,
            autocomplete: true,   // ← live suggestions from GitLab
          },
          {
            name: "all",
            description: "Generate for every active GitLab group member",
            type: 5,
            required: false,
          },
          {
            name: "week",
            description: "Which week — type to see options (last, this, 2026-W12, …)",
            type: 3,
            required: false,
            autocomplete: true,   // ← last 6 weeks as suggestions
          },
          {
            name: "range",
            description: "Rolling range — type to see options (7d, 30d, this-month, …)",
            type: 3,
            required: false,
            autocomplete: true,   // ← preset ranges as suggestions
          },
          {
            name: "from",
            description: "Start date (YYYY-MM-DD)",
            type: 3,
            required: false,
          },
          {
            name: "to",
            description: "End date (YYYY-MM-DD)",
            type: 3,
            required: false,
          },
          {
            name: "mode",
            description: "Output mode (default: changelog)",
            type: 3,
            required: false,
            choices: MODE_CHOICES,  // fixed list — no autocomplete needed
          },
          {
            name: "preview",
            description: "Show private preview with Approve / Discard buttons",
            type: 5,
            required: false,
          },
          {
            name: "thread",
            description: "Post all changelogs in a thread (use with all:true)",
            type: 5,
            required: false,
          },
        ],
      },

      // ── /changelog link ───────────────────────────────────────────────────
      {
        name: "link",
        description: "Link a Discord user to their GitLab username",
        type: 1,
        options: [
          { name: "user",   description: "Discord user",                         type: 6, required: true },
          { name: "gitlab", description: "GitLab username — type to search",     type: 3, required: true, autocomplete: true },
        ],
      },

      // ── /changelog unlink ─────────────────────────────────────────────────
      {
        name: "unlink",
        description: "Remove a Discord ↔ GitLab link",
        type: 1,
        options: [
          { name: "user", description: "Discord user to unlink", type: 6, required: true },
        ],
      },

      // ── /changelog list ───────────────────────────────────────────────────
      { name: "list", description: "Show all GitLab group members and who is Discord-linked", type: 1 },

      // ── /changelog stats ──────────────────────────────────────────────────
      {
        name: "stats",
        description: "MR metrics, review activity, and contribution breakdown",
        type: 1,
        options: [
          { name: "user",   description: "Discord user (default: you)",                 type: 6, required: false },
          { name: "gitlab", description: "GitLab username — type to search",            type: 3, required: false, autocomplete: true },
          { name: "week",   description: "Which week — type to see options",            type: 3, required: false, autocomplete: true },
          { name: "range",  description: "Rolling range — type to see options",         type: 3, required: false, autocomplete: true },
        ],
      },

      // ── /changelog leaderboard ───────────────────────────────────────────
      {
        name: "leaderboard",
        description: "Rank team members by MRs, lines, reviews, or merge speed",
        type: 1,
        options: [
          {
            name: "metric",
            description: "What to rank by (default: mrs)",
            type: 3,
            required: false,
            choices: [
              { name: "🏆 MRs Merged",            value: "mrs" },
              { name: "📝 Lines Changed",          value: "lines" },
              { name: "🔍 Reviews Given",          value: "reviews" },
              { name: "⚡ Fastest to Merge (avg)", value: "speed" },
            ],
          },
          { name: "week",  description: "Which week — type to see options",  type: 3, required: false, autocomplete: true },
          { name: "range", description: "Rolling range — type to see options", type: 3, required: false, autocomplete: true },
          { name: "from",  description: "Start date (YYYY-MM-DD)",           type: 3, required: false },
          { name: "to",    description: "End date (YYYY-MM-DD)",             type: 3, required: false },
          {
            name: "trend",
            description: "Show comparison vs previous period (default: true)",
            type: 5,
            required: false,
          },
        ],
      },

      // ── /changelog health ─────────────────────────────────────────────────
      { name: "health", description: "Check GitLab, AI, filters, and link status", type: 1 },

      // ── /changelog config ─────────────────────────────────────────────────
      {
        name: "config",
        description: "Manage personal filters and preferences",
        type: 2,
        options: [
          { name: "show", description: "Show your config", type: 1 },
          {
            name: "set",
            description: "Set a personal config value",
            type: 1,
            options: [
              {
                name: "key",
                description: "Which setting",
                type: 3,
                required: true,
                choices: [
                  { name: "style — default output mode",         value: "style" },
                  { name: "verbosity — brief / normal / detailed", value: "verbosity" },
                  { name: "timezone — e.g. Asia/Kolkata",        value: "timezone" },
                  { name: "exclude-labels — comma-separated",    value: "exclude-labels" },
                  { name: "include-repos — comma-separated",     value: "include-repos" },
                  { name: "exclude-repos — comma-separated",     value: "exclude-repos" },
                  { name: "min-lines — minimum diff size",       value: "min-lines" },
                  { name: "include-drafts — true / false",       value: "include-drafts" },
                  { name: "exclude-bots — true / false",         value: "exclude-bots" },
                ],
              },
              { name: "value", description: "Value to set", type: 3, required: true },
            ],
          },
          { name: "global-show", description: "Show global bot config (admin)", type: 1 },
          {
            name: "global-set",
            description: "Set a global config value (admin)",
            type: 1,
            options: [
              {
                name: "key",
                description: "Which setting",
                type: 3,
                required: true,
                choices: [
                  { name: "default-style", value: "default-style" },
                  { name: "exclude-labels", value: "exclude-labels" },
                  { name: "min-lines", value: "min-lines" },
                  { name: "exclude-bots", value: "exclude-bots" },
                ],
              },
              { name: "value", description: "Value to set", type: 3, required: true },
            ],
          },
        ],
      },

    ],
  },

  // ── /release (separate top-level command) ──────────────────────────────────
  {
    name: "release",
    description: "Generate milestone-based release notes",
    options: [
      {
        name: "generate",
        description: "Generate release notes for a milestone",
        type: 1,
        options: [
          {
            name: "milestone",
            description: "Milestone — type to search group milestones",
            type: 3,
            required: true,
            autocomplete: true,   // ← live milestone suggestions
          },
          {
            name: "project",
            description: "Limit to a specific project — type to search",
            type: 3,
            required: false,
            autocomplete: true,   // ← live project suggestions
          },
        ],
      },
    ],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});

if (res.ok) {
  const registered = await res.json() as Array<{ name: string }>;
  console.log(`✅ Registered ${registered.length} command(s):`);
  for (const cmd of registered) console.log(`  • /${cmd.name}`);
} else {
  console.error("❌ Failed:", res.status, await res.text());
  process.exit(1);
}
