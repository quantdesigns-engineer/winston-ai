# Security

## Architecture

```
User (browser, on the Mac or over Tailscale)
  |  HTTP (loopback) or HTTPS (Tailscale Serve terminating locally)
Go Router (127.0.0.1:49710)
  |- /slack/*   Legacy HTTP path (HMAC verified, not in live use)
  |- /api/*     Agent API (Basic Auth + rate limit + audit)
  \- /*         Next.js frontend (Basic Auth)
                  |
                Claude CLI subprocess

Slack ── outbound websocket (Socket Mode) ──► Go Router
```

The Mac binds only to loopback. There is no edge, no public hostname, no inbound port. Remote browser access goes through Tailscale (or whatever overlay you prefer); Slack works because the router holds an outbound websocket.

## Security Layers

### Network

- **Loopback-only bind.** Both `bin/polymr` (`127.0.0.1:49710`) and Next.js (`127.0.0.1:49711`) refuse non-local connections.
- **No public DNS, no open ports.** The Mac is not directly reachable from the internet or the LAN.
- **Outbound Slack websocket.** Slack events arrive over a connection the router initiated, authenticated by the App-Level Token. There is no inbound webhook surface.
- **Optional overlay for the web UI.** Tailscale Serve terminates HTTPS on the Mac and only admits devices on the tailnet — see [DEPLOYMENT.md](DEPLOYMENT.md).

### Authentication

The router enforces two authenticated paths plus health:

- **HTTP Basic Auth** on all `/api/*` and frontend routes. Constant-time comparison via `crypto/subtle`.
- **Slack Socket Mode** uses an App-Level Token (`xapp-…`, scope `connections:write`). The websocket is the only Slack channel the router listens on; the HTTP `/slack/*` handlers still verify HMAC-SHA256 with the signing secret (5-minute replay window) but are not in the live path.
- `/health` is the only unauthenticated endpoint and is only reachable over loopback.

With no edge in front of the router, **Basic Auth is the sole API auth layer**. Pick a long, random password.

### Rate Limiting

- API: 100 req/min per client IP
- Auth: 10 req/min per IP (brute force protection)
- IP is taken from `RemoteAddr`. No proxy headers (`X-Forwarded-For`, `Cf-Connecting-Ip`) are trusted, because the router only accepts loopback connections.

### Input Sanitization

- 13 prompt injection patterns filtered (e.g., "ignore previous instructions", "DAN mode")
- 4000 character input limit on all Slack and API inputs
- Bot messages (`bot_id` present) and non-plain subtypes are ignored to prevent loops
- Slack message responses truncated to 3000 characters (Slack's limit)

### Agent Containment

- Configurable per-agent execution timeout (default 10 minutes)
- Configurable per-agent turn limit (default 25 turns)
- `--dangerously-skip-permissions` required for headless operation (single-user only)

### Audit

- JSON append-only audit log at `~/Library/Logs/polymr-audit.log`
- Failed auth attempts logged with IP and attempted username
- Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, CSP
- Ops notifications to Slack on startup, shutdown, frontend status changes, model/prompt changes

## Defence in Depth Summary

Three concentric layers gate any remote access to the agent API:

1. **Network reachability.** Loopback bind + Tailscale identity (when used). A device must be on the tailnet to even open a TCP connection to the router.
2. **HTTP auth.** Basic Auth on `/api/*` and the dashboard. No request reaches a handler without a valid credential.
3. **Input hygiene.** Length cap and injection-pattern stripping before any user input reaches Claude.

Slack is gated by:

1. **Socket Mode token.** The websocket only opens with a valid `xapp-…` token scoped to the installed workspace.
2. **Subtype + bot filters.** Only plain user messages trigger agent runs.
3. **Input hygiene** as above.

## Secrets Management

All secrets live in `.env` and the router LaunchAgent plist. Both are excluded from git.

| Secret | Location |
|--------|----------|
| `POLYMR_USER` / `POLYMR_PASS` | `.env`, `web/.env.local`, router plist |
| `SLACK_BOT_TOKEN` | `.env`, router plist |
| `SLACK_APP_TOKEN` | `.env`, router plist |
| `SLACK_SIGNING_SECRET` | `.env`, router plist |
| `SLACK_OWNER_ID` | `.env`, router plist |
| `ELEVENLABS_API_KEY` | `.env`, router plist |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `.env`, router plist |
| `YOUTUBE_API_KEY` | `.env`, router plist |
| `NANO_BANANA_API_KEY` | `.env`, router plist |
| `KALI_VM_SSH_KEY` | `~/.ssh/kali_vm` |

### Rotation

1. **Slack:** api.slack.com/apps → OAuth & Permissions → Regenerate (bot token). Basic Information → Regenerate signing secret. Basic Information → App-Level Tokens → revoke + regenerate the `xapp-…` token used for Socket Mode.
2. **ElevenLabs:** elevenlabs.io → Settings → API Keys → Regenerate.
3. **Google:** console.cloud.google.com → Credentials → Regenerate client secret.
4. Update `.env`, regenerate plists (`scripts/install-services.sh`), restart services.

## File Permissions

| File | Permissions |
|------|-------------|
| `.env` | `600` |
| `com.winston.router.plist` | `600` |
| `~/.config/winston/*.json` | `600` |
| FileVault disk encryption | ON |
