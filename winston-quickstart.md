# Winston — Quickstart Guide

**Local personal AI agent platform — runs on the Mac mini, reached via Slack and (optionally) Tailscale.**

---

## What is Winston?

Winston is a self-hosted AI agent platform that runs on a Mac mini. It binds to loopback only — Slack works via outbound Socket Mode, and the web UI is reached locally or over Tailscale. It consists of:

| Component | What it does |
|---|---|
| **Go Router** (`bin/winston`) | HTTP server (loopback), Slack Socket Mode loop, agent orchestration |
| **Next.js Frontend** | Dashboard at `http://localhost:49711` (or via the router's reverse proxy on `:49710`) |

---

## Architecture

```
Slack ── outbound websocket (Socket Mode) ──┐
                                            ▼
Browser ── http://localhost:49710 ────► Go Router :49710
                                            │
                              reverse proxy ▼
                                       Next.js :49711
                                            │
                                  claude CLI (agents/*.md)
```

The Mac mini has no public hostname and no open ports. All inbound paths terminate on `127.0.0.1`.

---

## Services

Both services run as launchd agents (auto-start on login):

| Label | Binary | Bind |
|---|---|---|
| `com.winston.router` | `~/projects/winston/bin/winston` | `127.0.0.1:49710` |
| `com.winston.frontend` | `npm run start` (Next.js) | `127.0.0.1:49711` |

---

## Checking Status

### Quick health check
```bash
curl http://localhost:49710/health
```

Returns: `{ "status": "ok", "uptime": "...", "agents": 12, "frontend": "ok" }`

### Check which services are running
```bash
launchctl list | grep winston
```

- **PID number** = running
- **`-`** with exit code = stopped/crashed

### View live logs
```bash
# Router logs (includes Slack Socket Mode chatter)
tail -f ~/Library/Logs/winston-router.out.log
tail -f ~/Library/Logs/winston-router.err.log

# Frontend logs
tail -f ~/Library/Logs/winston-frontend.out.log
```

---

## Restarting Services

### Restart the router (most common)
```bash
launchctl kickstart -k gui/$(id -u)/com.winston.router
```

### Restart the frontend
```bash
launchctl kickstart -k gui/$(id -u)/com.winston.frontend
```

### Restart all Winston services
```bash
launchctl kickstart -k gui/$(id -u)/com.winston.router
launchctl kickstart -k gui/$(id -u)/com.winston.frontend
```

### After a code change (rebuild + restart)
```bash
cd ~/projects/winston
go build -o bin/winston ./cmd/winston
launchctl kickstart -k gui/$(id -u)/com.winston.router
```

Or just `./scripts/restart.sh` to rebuild both and bounce everything.

---

## Stopping Services

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.winston.router.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.winston.frontend.plist
```

---

## Agents

Agents are `.md` files in `~/.claude/agents/`. The router loads them automatically on start.

| Agent | Purpose |
|---|---|
| `winston` | General-purpose personal assistant |
| `marketing` | Marketing copy and strategy |
| `pentester` | Security testing |
| `designer` | Frontend UI design |
| `sdlc` | Software architecture planning |
| `team-research-*` | Research pipeline (example workspace grouping) |
| `acme-social` | Branded social-content pipeline (see `feat/social-workflow` branch) |
| `jobs-*` | Job search automation (see `feat/jobs-pipeline` branch) |

### Adding a new agent
1. Create `~/.claude/agents/my-agent.md` with a system prompt
2. Restart the router: `launchctl kickstart -k gui/$(id -u)/com.winston.router`

### Calling agents from Slack
```
/marketing analyze our latest campaign
/winston what's on my calendar today?
@Winston /pentester run a port scan on 192.168.1.1
```

---

## Slack Integration

The router connects to Slack via **Socket Mode** — an outbound websocket. No inbound webhook URL is needed. The router listens for three event types:

| Event | Purpose |
|---|---|
| Slash commands (`/marketing`, `/winston`, etc.) | Spawn an agent in a thread |
| App mentions (`@Winston`) and thread replies | Continue threaded conversations |
| Interactive components | Button clicks on bot messages |

### Troubleshooting Slack "something went wrong"
1. Check the router is running: `curl http://localhost:49710/health`
2. Check the Socket Mode connection is up: `grep '[slack/socket]' ~/Library/Logs/winston-router.err.log | tail`
3. If you see `connection error` or it's stuck on `connecting…`, the `SLACK_APP_TOKEN` (`xapp-…`) is missing or invalid — regenerate it in the Slack app's Basic Information page, update `.env`, and reinstall services.

---

## Configuration

All secrets live in `~/projects/winston/.env` (never committed to git):

```
PORT=49710
SLACK_BOT_TOKEN              # xoxb-... Slack bot token
SLACK_APP_TOKEN              # xapp-... App-Level token (connections:write) for Socket Mode
SLACK_SIGNING_SECRET         # Kept for the legacy HTTP /slack/* path
SLACK_NOTIFY_CHANNEL         # Channel for ops notifications
SLACK_OWNER_ID               # User ID for owner-targeted messages
ELEVENLABS_API_KEY           # Voice synthesis
```

The launchd plists at `~/Library/LaunchAgents/com.winston.router.plist` embed these directly (so the router has them without reading `.env`). Re-run `scripts/install-services.sh` after editing `.env` to regenerate the plists.

---

## Remote Access (Optional)

The router and frontend bind to `127.0.0.1` only. To reach the web UI from another device, use Tailscale Serve:

```bash
# On the Mac mini
tailscale serve --bg --https=443 http://127.0.0.1:49710
tailscale serve status
```

Open the printed `https://<machine>.<tailnet>.ts.net` URL from any device signed in to the same tailnet.

Slack does not need any of this — Socket Mode works regardless.

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| Slack "something went wrong" | Router down or Socket Mode disconnected | `curl localhost:49710/health`, check router log for `[slack/socket]` |
| Agent returns "not registered" | Agent `.md` file missing or router not restarted | Check `~/.claude/agents/`, kickstart router |
| Frontend unreachable | Next.js stopped | Kickstart frontend service |
| Slack bot connects but silent | Missing event subscriptions or OAuth scopes | Re-check the Slack app config |
| `tailscale serve` URL not reachable | Both devices need to be on the same tailnet with HTTPS enabled | `tailscale status` on each device |

---

*Winston is running on bare metal — no Docker, no VMs.*
