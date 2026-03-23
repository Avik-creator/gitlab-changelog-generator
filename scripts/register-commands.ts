/**
 * Register /changelog slash commands with Discord.
 * Run once (or whenever the command structure changes):
 *
 *   bun run register-commands
 */

const APP_ID   = process.env.DISCORD_APPLICATION_ID!;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .dev.vars");
  process.exit(1);
}

const FORMAT_CHOICES = [
  { name: "✨ Changelog  — professional prose summary",              value: "changelog" },
  { name: "🔧 PR Notes  — technical bullet-point release notes",    value: "pr" },
  { name: "📣 Press Release  — non-technical stakeholder summary",  value: "press-release" },
  { name: "📝 Release Notes  — structured Features/Fixes",          value: "release-notes" },
  { name: "⚡ Concise  — 2-sentence TL;DR",                          value: "concise" },
];

const commands = [
  {
    name: "changelog",
    description: "GitLab Changelog Bot",
    options: [
      // ─── /changelog generate ──────────────────────────────────────────────
      {
        name: "generate",
        description: "Generate a changelog from GitLab activity",
        type: 1,
        options: [
          {
            name: "user",
            description: "Discord user to generate for (default: you)",
            type: 6,        // USER
            required: false,
          },
          {
            name: "gitlab",
            description: "GitLab username directly, e.g. john.doe (no link required)",
            type: 3,
            required: false,
          },
          {
            name: "all",
            description: "Generate for every member of the GitLab group",
            type: 5,        // BOOLEAN
            required: false,
          },
          {
            name: "week",
            description: "Which week? last (default), this, 2026-W12, or 2 (weeks ago)",
            type: 3,
            required: false,
          },
          {
            name: "format",
            description: "Output format (default: changelog)",
            type: 3,
            required: false,
            choices: FORMAT_CHOICES,
          },
          {
            name: "preview",
            description: "Show a private preview before posting publicly (default: false)",
            type: 5,
            required: false,
          },
        ],
      },

      // ─── /changelog link ──────────────────────────────────────────────────
      {
        name: "link",
        description: "Link a Discord user to their GitLab username (validates against group)",
        type: 1,
        options: [
          { name: "user",   description: "Discord user",       type: 6, required: true },
          { name: "gitlab", description: "GitLab username",    type: 3, required: true },
        ],
      },

      // ─── /changelog unlink ───────────────────────────────────────────────
      {
        name: "unlink",
        description: "Remove a Discord ↔ GitLab link",
        type: 1,
        options: [
          { name: "user", description: "Discord user to unlink", type: 6, required: true },
        ],
      },

      // ─── /changelog list ─────────────────────────────────────────────────
      {
        name: "list",
        description: "Show GitLab group members and their Discord links",
        type: 1,
      },

      // ─── /changelog health ───────────────────────────────────────────────
      {
        name: "health",
        description: "Check GitLab API reachability, AI status, and link count",
        type: 1,
      },
    ],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
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
