# Winston documentation

Start with the [project README](../README.md) for the pitch and setup. These
docs go deeper.

| Doc | What it covers |
|---|---|
| [OVERVIEW.md](OVERVIEW.md) | The 5-minute mental model: services, surfaces, how Slack is wired. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internals — router, agent manager, scheduler, sessions, request lifecycle. |
| [AGENTS.md](AGENTS.md) | Authoring agents: frontmatter, system-prompt patterns, models, the agent roster. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Ops reference — launchd/systemd services, restarts, logs, remote access. |
| [SECURITY.md](SECURITY.md) | Threat model and hardening checklist. |
| [FEATURES.csv](FEATURES.csv) | Feature ledger / status tracking. |
| [MOBILE_APP_DESIGN_BRIEF.md](MOBILE_APP_DESIGN_BRIEF.md) | Design brief for the companion mobile client. |

## Screenshots

The images embedded in the README live in [`docs/img/`](img/). They're
captured from the real running app with Playwright driving system Chrome
through the authenticated router — not mockups. To regenerate after UI
changes, run the stack and re-capture the dashboard, schedules, jobs board,
and jobs wizard at the same viewport (1440×900, dark).
