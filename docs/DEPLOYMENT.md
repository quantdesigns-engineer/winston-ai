# Deployment

## Prerequisites

- macOS with Homebrew
- Go 1.25+
- Node.js 20+ and npm
- A Slack app with **Socket Mode** enabled (see "Slack App Setup" below)
- `tailscale` installed and signed in (only required if you want to reach the
  web UI from another device on your tailnet — the Slack bot itself works
  without Tailscale)

## Setup

### 1. Install dependencies

```bash
make deps
```

### 2. Configure environment

```bash
cp .env.example .env
chmod 600 .env
```

See `.env.example` for all available variables. Key additions beyond the basics:

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | `xoxb-...` — bot token from your Slack app. Required for posting messages. |
| `SLACK_APP_TOKEN` | `xapp-...` — app-level token with `connections:write` scope. **Required to connect to Slack via Socket Mode.** Without this, the bot will not respond to anything. |
| `SLACK_OWNER_ID` | Your Slack user ID (e.g., `U0123456789`). Used to tag you in scheduled agent results. |
| `ELEVENLABS_API_KEY` | Required for voice chat (STT + TTS). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Required for Google Calendar sync. |

### 3. Build

```bash
make build               # Go binary -> bin/winston
cd web && npm run build   # Next.js -> web/.next/
```

## Services

Two macOS LaunchAgents run in `~/Library/LaunchAgents/`:

| Service | Plist | Port (loopback only) |
|---------|-------|----------------------|
| Go router | `com.winston.router.plist` | 127.0.0.1:49710 |
| Next.js frontend | `com.winston.frontend.plist` | 127.0.0.1:49711 |

Both bind only to loopback. Slack reaches the bot via outbound Socket Mode, and the web UI is reached locally or via Tailscale (see "Tailscale Serve" below).

All services are configured with `KeepAlive` (auto-restart on crash). `install-services.sh` bakes `.env` into the router plist so values like `SLACK_APP_TOKEN` and `SLACK_OWNER_ID` are available to the Go process.

### Load services

```bash
UID_NUM=$(id -u)
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.winston.router.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.winston.frontend.plist
```

### Restart everything

```bash
./scripts/restart.sh
```

Rebuilds Go + Next.js, then bounces all services.

### Restart a single service

```bash
UID_NUM=$(id -u)
launchctl bootout gui/$UID_NUM ~/Library/LaunchAgents/com.winston.router.plist
launchctl bootstrap gui/$UID_NUM ~/Library/LaunchAgents/com.winston.router.plist
```

### Check status

```bash
launchctl list | grep winston
```

Exit code `0` in the second column = running.

## Persistent Data

The router stores state in `~/.config/winston/`:

| File | Contents | Survives restart? |
|------|----------|------------------|
| `sessions.json` | Active agent sessions (keyed by Slack thread TS) | Yes |
| `schedules.json` | All scheduled agent runs with cron patterns | Yes |

These files are created automatically on first use. Deleting them resets all sessions/schedules.

## Logs

```bash
tail -f ~/Library/Logs/winston-router.err.log     # Go router (incl. Slack socket logs)
tail -f ~/Library/Logs/winston-frontend.err.log   # Next.js
tail -f ~/Library/Logs/winston-audit.log           # Audit (JSON)
```

## Slack App Setup

Winston's Slack bot uses **Socket Mode** — it connects out to Slack over a websocket instead of receiving inbound webhooks. This means the Mac mini does not need any public hostname or open port for Slack to work.

In <https://api.slack.com/apps> for your Winston app:

1. **Socket Mode** → toggle on. Generate an **App-Level Token** with the `connections:write` scope. This is the `xapp-...` token; save it as `SLACK_APP_TOKEN` in `.env`.
2. **OAuth & Permissions** → install to your workspace. The `xoxb-...` bot token is `SLACK_BOT_TOKEN` in `.env`.
3. **Event Subscriptions** → enable. Subscribe to `app_mention` and `message.channels` (and `message.groups` if you use private channels). With Socket Mode on, no Request URL is needed.
4. **Slash Commands** → register one command per agent (`/marketing`, `/pentester`, etc). With Socket Mode on, no Request URL is needed for these either.
5. **Interactivity & Shortcuts** → enable. With Socket Mode on, no Request URL is needed.

After updating tokens, restart the router service so the new env vars are picked up.

## Tailscale Serve (web UI access)

The web UI is bound to `127.0.0.1:49711` and is fronted by the Go router on `127.0.0.1:49710`. Neither is reachable from the LAN. To access the UI from another device on your tailnet:

```bash
# On the Mac mini, expose the Go router over your tailnet (HTTPS)
tailscale serve --bg --https=443 http://127.0.0.1:49710
tailscale serve status
```

Open the printed `https://<machine>.<tailnet>.ts.net` URL from any device that's signed in to your Tailscale account. Tailscale's tailnet identity is the only access control — Winston has no per-request auth of its own.

To turn it off:

```bash
tailscale serve reset
```

Slack does **not** need Tailscale — Socket Mode is a pure outbound websocket from the Mac mini to Slack's servers.

## Updating Secrets

1. Update `.env` and `web/.env.local`
2. Re-run `bash scripts/install-services.sh` (regenerates plist with new env)
3. Or restart the router service to pick up new `.env`

Never commit `.env`, `.env.local`, or plist files to git.

## Ops Notifications

The router posts to Slack on key lifecycle events (startup, shutdown, frontend down/recovered, model changes, prompt changes). Set `SLACK_NOTIFY_CHANNEL` in `.env` to enable. If unset, events are logged locally only.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 502 Bad Gateway | Go router crashed. Check `winston-router.err.log`, rebuild, restart. |
| Frontend 500 | Stale build. Run `cd web && npm run build`, restart frontend. |
| Slack bot completely silent | `SLACK_APP_TOKEN` missing or invalid. Look for `[slack/socket] connection error` in `winston-router.err.log`. |
| Slack bot connects but doesn't react to events | Event Subscriptions not enabled in the Slack app, or scopes missing. Re-check the "Slack App Setup" section. |
| `tailscale serve` not reachable from another device | Confirm both devices are signed into the same tailnet (`tailscale status` on each). HTTPS on tailnets requires MagicDNS + HTTPS enabled in the Tailscale admin console. |
| 429 Too Many Requests | Rate limit: 100 req/min API, 10 req/min auth. |
| Schedules lost | Check `~/.config/winston/schedules.json` exists and is readable. |
| Scheduled runs not tagging you | Set `SLACK_OWNER_ID` in `.env` and reinstall services. |
| `missing_scope` errors in logs | Bot may lack `channels:join` scope but is already in the channel — this is tolerated. |
