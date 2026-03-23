/**
 * Run once to register /changelog slash commands with Discord.
 *
 * Usage:
 *   bun run scripts/register-commands.ts
 *
 * Requires env vars:
 *   DISCORD_APPLICATION_ID
 *   DISCORD_BOT_TOKEN
 */

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
  console.error("Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN environment variables.");
  process.exit(1);
}

const commands = [
  {
    name: "changelog",
    description: "Generate GitLab changelogs for team members",
    options: [
      // -----------------------------------------------------------------------
      // Subcommand: generate
      // -----------------------------------------------------------------------
      {
        name: "generate",
        description: "Generate a changelog for a user or all registered team members",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: "user",
            description: "Discord user to generate a changelog for",
            type: 6, // USER
            required: false,
          },
          {
            name: "gitlab_username",
            description: "GitLab username (alternative to Discord mention)",
            type: 3, // STRING
            required: false,
          },
          {
            name: "all",
            description: "Generate for all registered team members",
            type: 5, // BOOLEAN
            required: false,
          },
          {
            name: "format",
            description: "Output format for the AI summary (default: changelog)",
            type: 3, // STRING
            required: false,
            choices: [
              {
                name: "📋 Changelog  — prose summary of what shipped",
                value: "changelog",
              },
              {
                name: "🔧 PR Notes  — technical bullet-point release notes",
                value: "pr",
              },
              {
                name: "📣 Press Release  — non-technical announcement for stakeholders",
                value: "press-release",
              },
            ],
          },
        ],
      },
      // -----------------------------------------------------------------------
      // Subcommand: register
      // -----------------------------------------------------------------------
      {
        name: "register",
        description: "Link a Discord user to their GitLab username",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: "discord_user",
            description: "The Discord user to link",
            type: 6, // USER
            required: true,
          },
          {
            name: "gitlab_username",
            description: "Their GitLab username",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      // -----------------------------------------------------------------------
      // Subcommand: list
      // -----------------------------------------------------------------------
      {
        name: "list",
        description: "List all registered team members",
        type: 1, // SUB_COMMAND
      },
    ],
  },
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(commands),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Failed to register commands:", JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("✅ Slash commands registered successfully:");
  for (const cmd of data as { name: string; id: string }[]) {
    console.log(`  /${cmd.name}  (id: ${cmd.id})`);
  }
}

registerCommands();
