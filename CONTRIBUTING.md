# Contributing to Winston

Thanks for working on Winston. This repo is meant to read as a reference for
how we build and ship — so the bar for changes is "would I show this to
someone as an example of good practice?"

## Ground rules

- **`main` stays releasable.** Never commit directly to `main`. Branch, PR,
  merge.
- **One concern per branch.** A feature branch does one thing. Docs, refactors,
  and features don't ride together. (See `feat/jobs-pipeline` and
  `feat/social-workflow` for examples of self-contained feature branches.)
- **CI must be green** before merge — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Branch & commit conventions

```
feat/<area>-<short-desc>     a user-facing capability
fix/<area>-<short-desc>      a bug fix
docs/<short-desc>            documentation only
chore/<short-desc>           tooling, deps, vendoring
```

Commits use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(jobs): app-wide scraper status pill + wizard re-attach
fix(slack): resume thread session on app_mention
docs: rewrite README as a use-case-led showcase
```

Keep the subject ≤ 72 chars, explain the *why* in the body.

## Local checks (run before pushing)

```bash
make test          # Go unit tests, race detector, count=1
make test-security # security-specific tests
make test-cover    # coverage — keep total ≥ 60% (CI gate)
make lint          # go vet + golangci-lint
cd web && npx tsc --noEmit && npm run lint && npm run build
```

CI runs exactly these. If they pass locally, CI passes.

## Adding an agent

Agents are Markdown files in `~/.claude/agents/` — see the
[README](README.md#write-your-first-agent) and [docs/AGENTS.md](docs/AGENTS.md).
No code change is needed to add one; if you're changing how agents are
loaded or executed, that lives in `internal/agents/manager.go` and needs a
test.

## Pull requests

- Fill in the [PR template](.github/pull_request_template.md).
- Include a screenshot or terminal capture for any UI/UX or CLI change.
- Link the issue it closes.
- Small, reviewable PRs over large ones.

## Security

Never commit secrets — `.env` is git-ignored, keep it that way. Report
security issues privately rather than in a public issue. The threat model is
in [docs/SECURITY.md](docs/SECURITY.md).
