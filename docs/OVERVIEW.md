# Winston — Overview

Winston is an always-on personal agent stack running on Philip's Mac. It exposes ~17 Claude-CLI-backed agents through three surfaces: a web dashboard, a REST API, and Slack. Everything is local — agents run as subprocesses on the host machine and inherit its full environment (shell, SSH keys, files, API tokens).

---

## Services

Two long-running processes, both under launchd with auto-restart (`KeepAlive=true`):

| Service | launchd label | Bind | Purpose |
|---|---|---|---|
| **Go router** (`bin/winston`) | `com.winston.router` | `127.0.0.1:49710` | HTTP server. Routes requests, spawns agents, runs the Slack Socket Mode loop, proxies the frontend. |
| **Next.js frontend** (`web/`) | `com.winston.frontend` | `127.0.0.1:49711` | Web dashboard — agent chat, voice, schedules, jobs. Reverse-proxied by the router. |

Both services bind to loopback only. The Mac listens on no public ports and is not reachable from the internet. Slack works because it uses Socket Mode — an outbound websocket from the Mac to Slack — so there is no inbound webhook to expose.

Plists live in `~/Library/LaunchAgents/`, logs in `~/Library/Logs/winston-*.log`.

---

## Architecture

```
                       Slack (Socket Mode, outbound websocket)
                                       │
                                       ▼
                          Go Router  127.0.0.1:49710
                          ├─ /slack/*   (legacy HTTP path, unused)
                          ├─ /api/*     (Basic Auth + audit log)
                          ├─ /health    (loopback only)
                          └─ /*         → reverse proxy → Next.js 127.0.0.1:49711
                                       │
                          Agent Manager (in-memory + disk persistence)
                                       │
                          claude --print --model … (subprocess per run)
                                       │
                          Full local environment (files, shell, SSH, APIs)
```

Exposure:

| Surface | Address | Auth |
|---|---|---|
| Web dashboard | `http://localhost:49711` (direct) or `http://localhost:49710` (via router) | HTTP Basic Auth |
| REST API | `http://localhost:49710/api/*` | HTTP Basic Auth |
| Slack | Socket Mode (outbound) | Slack signing secret + bot/app tokens |
| Health | `http://localhost:49710/health` | None (loopback only) |

For off-host access, run `tailscale serve` to expose `127.0.0.1:49710` over your tailnet. Basic Auth still applies on top of Tailscale's identity check.

---

## Slack integration

### Thinking

Slack is the always-on conversational surface for Winston. Three goals shaped the design:

1. **No inbound webhooks.** Slack runs in Socket Mode — the Go router opens an outbound websocket to Slack on startup and receives events over it. Nothing on the Mac has to be reachable from Slack's IPs, and the loopback-only bind stays intact.
2. **Agents as first-class commands.** Every agent loaded by the manager automatically becomes a slash command (`/marketing`, `/pentester`, `/team-research`, …). No per-agent Slack config — register the agent file, restart the router, the command exists.
3. **Threads are sessions.** Replying in a thread continues the same Claude session (`claude --resume <id>`), so long-running back-and-forth conversations don't need to re-establish context.

### How it works

Triggered by Socket Mode events, dispatched in `internal/slack/socketmode.go`:

| Event | What it means | Handler |
|---|---|---|
| **Slash command** (`/agent prompt`) | User typed `/marketing analyze X` | Ack immediately, echo the command in-channel, spawn the agent asynchronously, stream output back into a placeholder message in the thread. |
| **App mention** (`@Winston …`) | User @'d the bot in a channel | Parse the agent name from the message, then same flow as slash command. In an existing thread, attempts to resume the thread's session first. |
| **Thread message** (no mention) | User replied in a thread that has an active session | Looks up the session by `thread_ts` and continues it via `claude --resume`. Bot edits and `subtype != ""` events are filtered to avoid loops. |
| **Interactive component** (button click) | User clicked a button on a bot message | Routed by `action_id` prefix (e.g. `youtube_topic_*`, `agent_followup`). |

Streaming: each run gets a `_thinking…_` placeholder; the handler edits it every ~2s with the agent's latest output, then writes the final result. Long replies are truncated to ~3000 chars (Slack's hard limit per block).

Operational notifications (router startup, shutdown, frontend-down alerts) are posted by `internal/notify/notify.go` under the username `Winston Ops`.

### Where Slack is available

- **Workspace:** whichever Slack workspace you install the app into.
- **Default channel:** set the channel ID via `SLACK_NOTIFY_CHANNEL` for ops notifications.
- **Bot display name:** Winston (configurable in App Home).
- **Owner DM target:** set `SLACK_OWNER_ID` to your Slack user ID for owner-specific pings.

Slash commands work in any channel the bot is in, and in DMs to the bot. Thread continuity works wherever the bot can post.

Required tokens (set in `.env`):

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` (`xoxb-…`) | API calls (post messages, look up channels) |
| `SLACK_APP_TOKEN` (`xapp-…`, `connections:write`) | Socket Mode websocket |
| `SLACK_SIGNING_SECRET` | HMAC verification (kept for the unused HTTP `/slack/*` path) |
| `SLACK_NOTIFY_CHANNEL` | Channel for ops notifications |
| `SLACK_OWNER_ID` | User ID for owner-targeted messages |

---

## Common operations

```bash
# Health
curl http://localhost:49710/health

# Restart everything (rebuild Go + Next.js, reload launchd)
./scripts/restart.sh

# Reinstall launchd services from scratch
./scripts/install-services.sh

# Tail logs
tail -f ~/Library/Logs/winston-router.err.log
tail -f ~/Library/Logs/winston-frontend.err.log

# Stop and remove
./scripts/uninstall-services.sh
```

If the Slack bot goes quiet, the first thing to check is whether the Socket Mode connection is up — search the router log for `[slack/socket] connected`. If it's stuck on `connecting…`, the `SLACK_APP_TOKEN` is missing or invalid.
