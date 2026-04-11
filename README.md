# Obsidian Telegram Sync

Sync messages from a Telegram bot into your Obsidian vault. Messages arrive in real time, are stored in Supabase, and are pulled into your vault as Markdown notes — with support for files, forum topics, message edits, and flexible routing rules.

## How it works

```
Telegram  →  Bot  →  Supabase Edge Function  →  Postgres  →  Obsidian plugin  →  Vault
```

1. You send a message to your Telegram bot.
2. Telegram pushes it to a Supabase Edge Function (`telegram-webhook`).
3. The message is stored in a Postgres table.
4. The Obsidian plugin polls (or uses Realtime) to fetch new messages and writes them to your vault as `.md` files.

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier works)
- A Telegram account
- [Node.js](https://nodejs.org) ≥ 20
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- [Obsidian](https://obsidian.md) desktop app

---

## Part 1 — Supabase setup

### 1.1 Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Choose a strong database password and save it.
3. Wait for the project to finish provisioning (about a minute).

### 1.2 Note your project credentials

From the Supabase dashboard → **Project Settings → API**:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **Anon / public key** — the `anon` key under "Project API keys"
- **Service role key** — click "Reveal" next to the `service_role` key (keep this secret)

From **Project Settings → General**:

- **Project ref** — the short ID in your project URL (e.g. `abcdefgh`)

### 1.3 Generate a bot token encryption key

This key encrypts your Telegram bot token before it is stored in the database. Generate a random 32-byte base64 key:

```bash
openssl rand -base64 32
```

Save the output — you will need it in the next step.

### 1.4 Add Edge Function secrets

In the Supabase dashboard → **Edge Functions → Manage secrets**, add:

| Secret name | Value |
|---|---|
| `BOT_TOKEN_ENCRYPTION_KEY` | The base64 key you just generated |

The Supabase built-in secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are injected automatically — you do not need to add them.

### 1.5 Apply database migrations

Clone this repository and link it to your Supabase project:

```bash
git clone <repo-url>
cd obsidian-telegram
npm install

supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

This applies all migrations and creates the required tables, functions, indexes, and RLS policies.

### 1.6 Enable required Postgres extensions

Some migrations use `pg_cron` and `pg_net`. Enable them in the Supabase dashboard:

**Database → Extensions** → search for and enable:
- `pg_net`
- `pg_cron`

If the migrations already ran before you enabled the extensions, re-run `supabase db push` or run the last two migrations again.

### 1.7 Deploy Edge Functions

```bash
supabase functions deploy setup-bot --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy usage-warning-check --no-verify-jwt
```

Verify all three show as **Active** in the dashboard under **Edge Functions**.

---

## Part 2 — Telegram bot setup

### 2.1 Create a bot with BotFather

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Choose a name (shown in chats) and a username (ends in `bot`).
4. BotFather gives you a **bot token** — save it. It looks like `1234567890:ABCdef...`

### 2.2 Add the bot to your chat

The bot can sync messages from:

- A **private chat** with the bot (just open it and send `/start`)
- A **group or supergroup** (add the bot as a member)
- A **channel** (add the bot as an admin)
- A **forum group with topics** (add the bot as a member; topics are auto-detected)

> The bot only sees messages sent after it joined. It does not have access to message history.

### 2.3 Allow the bot to read messages (groups only)

By default, bots only see messages that mention them. To let the bot see all messages in a group, disable privacy mode:

1. In BotFather, send `/mybots` → select your bot → **Bot Settings → Group Privacy → Turn off**.

---

## Part 3 — Obsidian plugin setup

### 3.1 Install the plugin

Until this plugin is published to the Obsidian community registry, install it manually:

1. Build the plugin:
   ```bash
   npm install --prefix plugin
   npm run build:plugin
   ```
2. Copy the output files into your vault's plugin folder:
   ```
   <vault>/.obsidian/plugins/obsidian-telegram/
   ├── main.js
   ├── manifest.json
   └── styles.css   (if present)
   ```
3. In Obsidian → **Settings → Community plugins**, enable **Obsidian Telegram Sync**.

### 3.2 Connect to Supabase

In the plugin settings:

1. Enter your **Supabase URL** and **Anon key** (from step 1.2).
2. Click **Reconnect**.
3. Enter your **email** and click **Send code**. Enter the OTP you receive.
4. You should see "Signed in as …" in the status bar.

### 3.3 Connect your Telegram bot

In the plugin settings under **Telegram bot**:

1. Paste your **bot token** (from step 2.1).
2. Click **Setup bot**.

This registers the webhook with Telegram so messages flow into your Supabase project. On success you will see your bot's username confirmed in the settings.

> The bot token is never stored in plain text. It is encrypted with AES-GCM before being saved to the database.

### 3.4 Test the connection

Send a message to your bot (or in your group/channel). Within 30 seconds (or instantly if Realtime is enabled) a `.md` file should appear in your vault under `Telegram/`.

---

## Configuration

### Note path template

Controls where messages are saved. Default:

```
Telegram/{{chat}}/{{topic}}{{messageDate:YYYY-MM-DD HH-mm-ss}}-{{messageId}}.md
```

### Message template

Controls the content rendered inside each note. Default:

```
- {{messageDate:YYYY-MM-DD HH:mm:ss}} {{user}}
  - Chat: {{chat}}
  - Type: {{messageType}}

  {{content}}
```

### File path template

Controls where media attachments are saved. Default:

```
Telegram/files/{{chat}}/{{file:name}}.{{file:extension}}
```

### Template variables

| Variable | Description |
|---|---|
| `{{chat}}` | Chat title or numeric chat ID |
| `{{chatId}}` | Numeric chat ID |
| `{{topic}}` | `topic-name/` for forum topics, empty otherwise |
| `{{topicId}}` | Numeric topic ID or empty |
| `{{user}}` | `@username` or full name of the sender |
| `{{messageId}}` | Telegram message ID |
| `{{messageType}}` | `text`, `photo`, `document`, `video`, `audio`, `voice`, `caption`, `service` |
| `{{content}}` | Full message text or caption |
| `{{content:N}}` | First N characters of content |
| `{{messageDate:FORMAT}}` | Message timestamp — use `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss` |
| `{{file:name}}` | File name without extension |
| `{{file:extension}}` | File extension |

---

## Distribution rules

Rules let you route messages to different notes or folders based on chat, topic, sender, or content.

Rules are checked top to bottom. The **first matching rule** wins. If no rule matches, the message is dropped.

### Filter query syntax

| Syntax | Meaning |
|---|---|
| `{{all}}` | Match every message |
| `{{chat=Name}}` | Chat title or ID equals "Name" (case-insensitive) |
| `{{chat!=Name}}` | Chat title or ID does not equal "Name" |
| `{{chat~word}}` | Chat title contains "word" |
| `{{topic=General}}` | Topic name or ID equals "General" |
| `{{user=alice}}` | Sender username or name equals "alice" |
| `{{content~todo}}` | Message text contains "todo" |

Combine multiple conditions in one filter query — all must match (AND logic):

```
{{chat=Work}}{{topic~Project}}
```

### Example rule set

```
Rule 1:  {{chat=Ideas}}
         Note path: Ideas/{{messageDate:YYYY-MM-DD}}.md

Rule 2:  {{chat=Work}}{{topic~Standup}}
         Note path: Work/Standup/{{messageDate:YYYY-MM-DD}}.md

Rule 3:  {{all}}
         Note path: Telegram/{{chat}}/{{messageDate:YYYY-MM-DD HH-mm-ss}}-{{messageId}}.md
```

---

## Advanced options

### Polling vs Realtime

| Setting | Behaviour |
|---|---|
| **Poll interval** | Plugin checks for new messages every N seconds (default: 30) |
| **Realtime enabled** | Supabase Realtime triggers an immediate poll on new messages |

Realtime gives near-instant delivery but uses a persistent WebSocket connection. Keep it off if you want lower resource usage.

### Storage warnings

The plugin estimates your Supabase usage (database rows + file storage) and can send you a Telegram message when you approach a configured limit.

| Setting | Description |
|---|---|
| **Storage limit (MB)** | Soft limit used for the estimate (default: 1024 MB) |
| **Warning threshold (%)** | Warn when usage exceeds this percentage (default: 80%) |
| **Telegram warnings** | Send the warning via your connected bot |

The warning is sent at most once per threshold crossing and resets automatically when usage drops below the threshold.

---

## Troubleshooting

### Messages are not appearing in the vault

1. Check that the bot is connected — the plugin settings should show the bot username.
2. Send a message, then wait up to 30 seconds (or enable Realtime).
3. Check the Supabase dashboard → **Edge Functions → telegram-webhook** logs for errors.
4. Confirm the bot can read messages in your chat (see step 2.3 for groups).

### Setup bot returns 401

This can happen if your Supabase project uses asymmetric JWT signing (ES256) and the Edge Functions are deployed with `verify_jwt = true`. The fix is to deploy the functions with `verify_jwt = false` — auth is enforced inside the function via the Bearer token. See step 1.7.

### Duplicate sync_clients rows

Each Obsidian installation gets a unique `client_id` stored in the plugin's `data.json`. If you copy a vault or reinstall the plugin, a new ID may be generated, leaving an old row behind. Old rows are harmless but can be deleted from the `sync_clients` table in the Supabase dashboard.

### Messages appear but files (photos, documents) are missing

Check that the `telegram-files` storage bucket exists in your Supabase project (created by the initial migration). If the Edge Function lacks permission to write to storage, check the service role key is correctly set in the function secrets.

### Large files (videos, documents) are not downloaded

The Telegram Bot API limits file downloads to **20 MB**. Anything larger cannot be pulled by the bot at all — this is a hard limit on Telegram's side, not a plugin setting. The `telegram-webhook` function detects oversized files, records the message with its file metadata (name, size, mime type) but `file_path` stays empty, and the webhook returns 200 so Telegram stops retrying. To bypass the 20 MB ceiling you would need a self-hosted [local Bot API server](https://github.com/tdlib/telegram-bot-api) (download limit ~2 GB) and point the bot at it instead of `api.telegram.org`.

---

## Repository layout

```
obsidian-telegram/
├── plugin/                  Obsidian plugin (TypeScript + esbuild)
│   └── src/
│       ├── main.ts          Plugin entry point
│       ├── sync-engine.ts   Polling, cursor management, Realtime
│       ├── vault-writer.ts  File creation and editing in the vault
│       ├── message-renderer.ts  Markdown rendering with block markers
│       ├── template-engine.ts   Template variable expansion
│       ├── distribution-rules.ts  Filter query evaluation
│       ├── settings-tab.ts  Settings UI
│       └── types.ts         Shared TypeScript types
├── supabase/
│   ├── config.toml          Local dev config
│   ├── functions/
│   │   ├── telegram-webhook/    Receives messages from Telegram
│   │   ├── setup-bot/           Registers webhook, encrypts token
│   │   └── usage-warning-check/ Sends storage warnings via Telegram
│   └── migrations/          Postgres schema migrations (apply in order)
├── scripts/                 Bootstrap and verification scripts
└── docs/                    Architecture and planning notes
```
