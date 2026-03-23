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
  { name: "✨ Changelog — professional prose", value: "changelog" },
  { name: "🔧 PR Notes — technical bullets", value: "pr" },
  { name: "📣 Press Release — stakeholder summary", value: "press-release" },
  { name: "📝 Release Notes — Features/Fixes/Improvements", value: "release-notes" },
  { name: "⚡ Concise — 2-sentence TL;DR", value: "concise" },
  { name: "📊 Manager — impact + blockers + risks", value: "manager" },
  { name: "🏗️ Engineering — deep technical detail", value: "engineering" },
  { name: "🎯 Executive — business impact only", value: "executive" },
];

const commands = [
  {
    name: "changelog",
    description: "GitLab Changelog Bot",
    options: [
      // ── generate ─────────────────────────────────────────────────────────
      {
        name: "generate",
        description: "Generate a changelog (user, project, label, milestone, or everyone)",
        type: 1,
        options: [
          { name: "user",      description: "Discord user (default: you)",         type: 6, required: false },
          { name: "gitlab",    description: "GitLab username directly",            type: 3, required: false },
          { name: "project",   description: "Project path (e.g. group/project)",   type: 3, required: false },
          { name: "label",     description: "Filter by label (e.g. backend)",      type: 3, required: false },
          { name: "milestone", description: "Filter by milestone (e.g. v2.4)",     type: 3, required: false },
          { name: "all",       description: "Generate for all GitLab group members", type: 5, required: false },
          { name: "week",      description: "Week: last, this, 2026-W12, 2",      type: 3, required: false },
          { name: "range",     description: "Range: 7d, 14d, 30d, this-month, last-month, 2026-03", type: 3, required: false },
          { name: "from",      description: "Start date (YYYY-MM-DD)",             type: 3, required: false },
          { name: "to",        description: "End date (YYYY-MM-DD)",               type: 3, required: false },
          { name: "mode",      description: "Output mode",                         type: 3, required: false, choices: MODE_CHOICES },
          { name: "preview",   description: "Private preview before posting",      type: 5, required: false },
        ],
      },

      // ── link ─────────────────────────────────────────────────────────────
      {
        name: "link",
        description: "Link Discord user → GitLab username",
        type: 1,
        options: [
          { name: "user",   description: "Discord user",    type: 6, required: true },
          { name: "gitlab", description: "GitLab username",  type: 3, required: true },
        ],
      },

      // ── unlink ───────────────────────────────────────────────────────────
      {
        name: "unlink",
        description: "Remove Discord ↔ GitLab link",
        type: 1,
        options: [
          { name: "user", description: "Discord user", type: 6, required: true },
        ],
      },

      // ── list ─────────────────────────────────────────────────────────────
      { name: "list", description: "Show GitLab group members + Discord links", type: 1 },

      // ── stats ────────────────────────────────────────────────────────────
      {
        name: "stats",
        description: "Show MR stats, review activity, and contribution metrics",
        type: 1,
        options: [
          { name: "user",   description: "Discord user (default: you)", type: 6, required: false },
          { name: "gitlab", description: "GitLab username",             type: 3, required: false },
          { name: "week",   description: "Week: last, this, 2026-W12", type: 3, required: false },
          { name: "range",  description: "Range: 7d, 14d, 30d, this-month", type: 3, required: false },
        ],
      },

      // ── health ───────────────────────────────────────────────────────────
      { name: "health", description: "Check GitLab, AI, filters, and link status", type: 1 },

      // ── config ───────────────────────────────────────────────────────────
      {
        name: "config",
        description: "Manage filters and preferences",
        type: 2, // SUB_COMMAND_GROUP
        options: [
          {
            name: "show",
            description: "Show your personal config",
            type: 1,
          },
          {
            name: "set",
            description: "Set a config value (e.g. style, exclude-labels, min-lines)",
            type: 1,
            options: [
              {
                name: "key",
                description: "Config key",
                type: 3,
                required: true,
                choices: [
                  { name: "style — default output mode",          value: "style" },
                  { name: "verbosity — brief/normal/detailed",    value: "verbosity" },
                  { name: "timezone — e.g. Asia/Kolkata",         value: "timezone" },
                  { name: "exclude-labels — comma-separated",     value: "exclude-labels" },
                  { name: "include-repos — comma-separated",      value: "include-repos" },
                  { name: "exclude-repos — comma-separated",      value: "exclude-repos" },
                  { name: "min-lines — minimum diff size",        value: "min-lines" },
                  { name: "include-drafts — true/false",          value: "include-drafts" },
                  { name: "exclude-bots — true/false",            value: "exclude-bots" },
                ],
              },
              { name: "value", description: "Value to set", type: 3, required: true },
            ],
          },
          {
            name: "global-show",
            description: "Show global config (admin)",
            type: 1,
          },
          {
            name: "global-set",
            description: "Set a global config value (admin)",
            type: 1,
            options: [
              {
                name: "key",
                description: "Config key",
                type: 3,
                required: true,
                choices: [
                  { name: "default-style — global default mode",  value: "default-style" },
                  { name: "exclude-labels — comma-separated",     value: "exclude-labels" },
                  { name: "min-lines — minimum diff size",        value: "min-lines" },
                  { name: "exclude-bots — true/false",            value: "exclude-bots" },
                ],
              },
              { name: "value", description: "Value to set", type: 3, required: true },
            ],
          },
        ],
      },
    ],
  },

  // ── /release (separate top-level command) ───────────────────────────────────
  {
    name: "release",
    description: "Generate release notes from milestones",
    options: [
      {
        name: "generate",
        description: "Generate release notes for a milestone",
        type: 1,
        options: [
          { name: "milestone", description: "Milestone title (e.g. v2.4)", type: 3, required: true },
          { name: "project",   description: "Limit to a specific project", type: 3, required: false },
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
