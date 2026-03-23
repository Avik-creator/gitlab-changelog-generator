# GitLab Changelog Generator

A Cloudflare Worker that generates weekly changelogs from GitLab MRs and commit history, surfaced through Discord slash commands.

## Features

- `/changelog generate @user` — on-demand changelog for a specific team member
- `/changelog generate gitlab:username` — use GitLab username directly
- `/changelog generate all:true` — generate for all registered team members
- `/changelog register @user gitlab:username` — link Discord → GitLab
- `/changelog list` — show all registered users
- Weekly auto-post every Monday at 9am (Cloudflare Cron Trigger)
- AI-powered summary using Cloudflare Workers AI (GLM-4.7-Flash by Zhipu AI — 131K context, multilingual)

---

## Setup

### 1. Prerequisites

- [Bun](https://bun.sh) installed
- A [Cloudflare account](https://dash.cloudflare.com) with Workers access
- A Discord application with a bot token
- A GitLab personal access token with `api` scope

### 2. Install dependencies

```bash
bun install
```

### 3. Create the KV namespace

```bash
bun run kv:create
```

# https://discord.com/oauth2/authorize?client_id=1480908278841217204&scope=bot+applications.commands&permissions=2048

Copy the `id` and `preview_id` from the output into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "USERS_KV"
id = "PASTE_ID_HERE"
preview_id = "PASTE_PREVIEW_ID_HERE"
```

### 4. Configure `wrangler.toml`

Fill in the non-secret vars:

```toml
[vars]
DISCORD_APPLICATION_ID = "your_app_id"
GITLAB_BASE_URL = "https://gitlab.yourorg.com"
GITLAB_GROUP_ID = "your_group_id"
DISCORD_CHANGELOG_CHANNEL_ID = "your_channel_id"
```

### 5. Set secrets

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put GITLAB_TOKEN
```

### 6. Set up your Discord application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Under **Bot**, enable the bot and copy the token
4. Under **General Information**, copy the **Public Key** and **Application ID**
5. Under **OAuth2 → URL Generator**, select scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`
   - Use the generated URL to invite the bot to your server

### 7. Register slash commands

```bash
DISCORD_APPLICATION_ID=your_id DISCORD_BOT_TOKEN=your_token bun run register-commands
```

This only needs to be run once (or when you change commands).

### 8. Deploy

```bash
bun run deploy
```

### 9. Set the Interactions Endpoint URL

In the Discord Developer Portal → **General Information**, set:

```
Interactions Endpoint URL: https://gitlab-changelog-generator.<your-subdomain>.workers.dev/interactions
```

Discord will send a PING to verify it. Your Worker will respond with PONG.

---

## Local Development

```bash
# Copy example vars
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with your actual secrets

bun run dev
```

Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local server for Discord interaction testing.

---

## Architecture

```
Discord Slash Command
        │
        ▼
Cloudflare Worker (Hono)
  POST /interactions
        │
        ├── Verify Ed25519 signature
        ├── Return deferred response immediately (< 3s)
        └── waitUntil():
              │
              ├── GitLab REST API
              │     ├── GET /groups/:id/merge_requests (by author, past 7 days)
              │     ├── GET /projects/:id/merge_requests/:iid/commits
              │     └── GET /projects/:id
              │
              ├── Cloudflare Workers AI
              │     └── Llama 3.3 70B — summarize MRs + commits
              │
              └── Discord REST API
                    └── PATCH /webhooks/:app_id/:token/messages/@original
```

### Cron Trigger

Every Monday at 9am UTC, `scheduled()` fires and posts changelogs for all registered users to `DISCORD_CHANGELOG_CHANNEL_ID`.

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `DISCORD_APPLICATION_ID` | `wrangler.toml [vars]` | Discord app ID |
| `DISCORD_BOT_TOKEN` | CF Secret | Bot token for posting messages |
| `DISCORD_PUBLIC_KEY` | CF Secret | Ed25519 public key for verifying interactions |
| `DISCORD_CHANGELOG_CHANNEL_ID` | `wrangler.toml [vars]` | Channel ID for weekly auto-posts |
| `GITLAB_TOKEN` | CF Secret | Personal access token with `api` scope |
| `GITLAB_BASE_URL` | `wrangler.toml [vars]` | e.g. `https://gitlab.yourorg.com` |
| `GITLAB_GROUP_ID` | `wrangler.toml [vars]` | Numeric ID of your top-level group |
