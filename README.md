# GitLab Changelog Generator

A Cloudflare Worker that generates AI-powered changelogs from GitLab merge requests and commit history, surfaced through Discord slash commands. Posts to a dedicated `#changelog` channel with support for threads, leaderboards, digest comparisons, and 8 output modes.

---

## Commands

### `/changelog generate` — Generate a changelog

| Option | Type | Description |
|---|---|---|
| `user` | Discord @mention | Generate for a specific Discord user |
| `gitlab` | string (autocomplete) | Generate by GitLab username |
| `project` | string (autocomplete) | Generate for an entire project |
| `label` | string (autocomplete) | Generate for all MRs with a label |
| `milestone` | string (autocomplete) | Generate for a milestone |
| `all` | boolean | Generate for every active GitLab group member |
| `week` | string (autocomplete) | Which ISO week — `last`, `this`, `2026-W12`, … |
| `range` | string (autocomplete) | Rolling range — `7d`, `30d`, `this-month`, … |
| `from` | string | Start date `YYYY-MM-DD` |
| `to` | string | End date `YYYY-MM-DD` |
| `mode` | choice | Output style (see modes below) |
| `preview` | boolean | Show private preview with Approve / Discard buttons |
| `thread` | boolean | Post all changelogs in a thread (use with `all:true`) |

**Thread mode** (`all:true thread:true`) — posts one team overview card to `#changelog` and creates a thread where each member's individual changelog appears. Keeps the channel clean.

**Digest modes:**

| Value | Description |
|---|---|
| `changelog` | Professional prose (default) |
| `pr` | Technical bullet points |
| `press-release` | Marketing / stakeholder summary |
| `release-notes` | Structured Features / Fixes / Improvements |
| `concise` | 2-sentence TL;DR |
| `manager` | Impact + blockers + cross-team context |
| `engineering` | Deep technical detail |
| `executive` | High-level business impact |

**Trend comparisons** — every single-user generate automatically compares this period to the previous equivalent period (e.g. this week vs. last week) and shows `▲/▼` deltas in the embed. Requires at least two runs over consecutive periods.

---

### `/changelog leaderboard` — Rank team members

Ranks every active GitLab group member for a chosen period.

| Option | Type | Description |
|---|---|---|
| `metric` | choice | `mrs` (default), `lines`, `reviews`, `speed` |
| `week` | string (autocomplete) | Which ISO week |
| `range` | string (autocomplete) | Rolling range |
| `from` / `to` | string | Explicit date range |
| `trend` | boolean | Show ▲/▼ vs previous period (default: true) |

Metrics:
- **MRs Merged** — total merge requests merged
- **Files Changed** — files touched across all MRs
- **Reviews Given** — review comments + approvals
- **Fastest to Merge** — lowest average hours from open → merge

Results are cached in KV — subsequent calls for the same period are free (no GitLab API calls).

---

### `/changelog stats` — Personal contribution breakdown

| Option | Type | Description |
|---|---|---|
| `user` | Discord @mention | Stats for a specific user (default: you) |
| `gitlab` | string (autocomplete) | By GitLab username |
| `week` | string (autocomplete) | Which week |
| `range` | string (autocomplete) | Rolling range |

Shows: MRs merged, lines changed, repos touched, avg time to merge, reviews given, approvals, comments, top labels.

---

### `/changelog link` — Link Discord ↔ GitLab

```
/changelog link user:@alice gitlab:alice.smith
```

Maps a Discord user to their GitLab username. GitLab username is validated against the group members.

### `/changelog unlink`

```
/changelog unlink user:@alice
```

### `/changelog list`

Shows all GitLab group members and which ones are Discord-linked.

---

### `/changelog config` — Personal preferences

| Subcommand | Description |
|---|---|
| `config show` | Show your current config |
| `config set key:… value:…` | Set a personal preference |
| `config global-show` | Show global bot config (admin) |
| `config global-set key:… value:…` | Set a global config value (admin) |

Configurable keys: `style`, `verbosity`, `timezone`, `exclude-labels`, `include-repos`, `exclude-repos`, `min-lines`, `include-drafts`, `exclude-bots`

---

### `/changelog health`

Checks GitLab API connectivity, Workers AI, Discord linking counts, and active filters.

---

### `/release generate` — Milestone release notes

```
/release generate milestone:"v2.1" project:group/my-app
```

| Option | Type | Description |
|---|---|---|
| `milestone` | string (autocomplete) | Milestone title (required) |
| `project` | string (autocomplete) | Limit to a specific project |

Classifies MRs into Features, Bug Fixes, Improvements, Breaking Changes, and Internal. Generates an AI summary tuned for release notes.

---

## Weekly auto-post

Every **Monday at 9 AM UTC**, the bot automatically generates changelogs for all active GitLab group members and posts to `DISCORD_CHANGELOG_CHANNEL_ID`. Members with zero activity are silently skipped.

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

Copy the `id` and `preview_id` from the output into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "USERS_KV"
id = "PASTE_ID_HERE"
preview_id = "PASTE_PREVIEW_ID_HERE"
```

### 4. Configure `wrangler.toml`

```toml
[vars]
DISCORD_APPLICATION_ID = "your_app_id"
GITLAB_BASE_URL = "https://gitlab.yourorg.com"   # or https://gitlab.com
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
   - Bot permissions: `Send Messages`, `Embed Links`, `Create Public Threads`
   - Use the generated URL to invite the bot to your server

### 7. Register slash commands

```bash
DISCORD_APPLICATION_ID=your_id DISCORD_BOT_TOKEN=your_token bun run register-commands
```

Only needs to be run once, or when commands change.

### 8. Deploy

```bash
bun run deploy
```

### 9. Set the Interactions Endpoint URL

In the Discord Developer Portal → **General Information**, set:

```
Interactions Endpoint URL: https://<your-worker>.workers.dev/interactions
```

Discord will send a PING to verify. Your Worker responds with PONG automatically.

---

## Local Development

```bash
cp .dev.vars.example .dev.vars
# fill in secrets
bun run dev
```

Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local server for Discord interaction testing.

---

## Architecture

```
Discord Slash Command / Autocomplete
          │
          ▼
Cloudflare Worker  POST /interactions
          │
          ├── Ed25519 signature verification
          │
          ├── Type 1 PING           → PONG  (synchronous)
          ├── Type 4 AUTOCOMPLETE   → choices from GitLab/KV  (synchronous, <3s)
          ├── Type 3 COMPONENT      → button approve/discard
          └── Type 2 SLASH COMMAND  → defer ACK → waitUntil():
                    │
                    ├── Cloudflare KV
                    │     ├── Discord ↔ GitLab user mappings
                    │     ├── Per-user & global config
                    │     ├── Autocomplete cache (5 min TTL)
                    │     └── Stats cache (7 day TTL, for trend comparisons)
                    │
                    ├── GitLab REST API
                    │     ├── Group members, projects, labels, milestones
                    │     ├── Merged MRs by author / project / label / milestone
                    │     ├── Commits + diff stats per MR (enrichment)
                    │     ├── Open & stale MRs (blockers)
                    │     └── Review activity (notes, approvals)
                    │
                    ├── Cloudflare Workers AI
                    │     └── @cf/zai-org/glm-4.7-flash — summarize per digest mode
                    │
                    └── Discord REST API
                          ├── PATCH /webhooks/:app/:token  (edit deferred reply)
                          ├── POST /channels/:id/messages  (post to channel)
                          └── POST /messages/:id/threads   (thread mode)
```

### Cron Trigger

Every Monday 09:00 UTC → `scheduled()` fires → changelogs for all GitLab group members → post to `#changelog`.

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `DISCORD_APPLICATION_ID` | `wrangler.toml [vars]` | Discord app ID |
| `DISCORD_BOT_TOKEN` | CF Secret | Bot token for posting messages |
| `DISCORD_PUBLIC_KEY` | CF Secret | Ed25519 public key for verifying interactions |
| `DISCORD_CHANGELOG_CHANNEL_ID` | `wrangler.toml [vars]` | Channel for weekly auto-posts |
| `GITLAB_TOKEN` | CF Secret | Personal access token with `api` scope |
| `GITLAB_BASE_URL` | `wrangler.toml [vars]` | `https://gitlab.com` or self-hosted URL |
| `GITLAB_GROUP_ID` | `wrangler.toml [vars]` | Numeric ID of your top-level group |

---

## Bot invite URL

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=2048
```
