# Social media workflow

A worked example of using Winston as a fully-automated marketing
content pipeline. Demonstrated against a fictional brand —
**Acme Insights** — so the pattern is portable. Substitute your own
brand context in the agent frontmatter and the prompt body.

This is a feature branch (`feat/social-workflow`) so the base platform
on `main` stays small. To work on or run it, branch from here.

## What this branch adds

### Agents (`agents/`)

| File | Model | What it does |
|------|-------|--------------|
| `acme-marketing.md` | Sonnet | Generalist marketing operator — competitor research, SEO audits, copy generation, campaign analysis, asset-pipeline orchestration. Use for ad-hoc marketing tasks. |
| `acme-social.md` | Opus | End-to-end weekly social content pipeline: multi-source trend research → 7 topic proposals (email + Slack) → user picks 3 → platform-tailored copy + scroll-stopping visuals + Manim/kinetic animations → Google Drive upload + Postiz drafts + email. |

Each is just a Markdown file; restart the router and they become
`/acme-marketing` and `/acme-social` in Slack, dashboard cards, HTTP
endpoints, and schedulable agents.

### Skills (`skills/`)

Skills are tool-augmenting modules the agents call into via the
`Skill` tool. Three are vendored here because they back the
asset-generation phase of the social pipeline:

| Skill | What it does |
|-------|--------------|
| `nanobanana/` | Wraps Google Gemini 3 Pro Image (Nano Banana Pro) for text-to-image and image editing. Higher-end model, supports 2K/4K, used for the hero images on each post. |
| `ai-image-generation/` | Provider-agnostic image generation via `inference.sh`. FLUX / Grok / Seedream / Reve / etc. Used as a fallback or for variant generation. |
| `frontend-dev/` | Doctorate-level frontend design expert that turns brand assets into a reusable design system + component code. Used to translate the brand into actual rendered carousels and layouts. |

`skills/SETUP.md` documents how Winston discovers and loads the
skills.

## How a scheduled run looks

The social pipeline is exactly the kind of thing scheduling is for —
one cron entry, every week, no human in the loop except the
3-topic pick.

```bash
curl -X POST -u "$USER:$PASS" http://localhost:49710/api/schedules \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_id": "acme-social",
    "cron": "0 8 * * 1",
    "prompt": "Run the weekly social pipeline.",
    "slack_channel": "#marketing"
  }'
```

Monday 8am, the agent runs research across Google Trends + Reddit +
SERP + visual-trend sources, emails 7 topic proposals, posts them to
Slack, and waits. The marketer replies with "1, 4, 6" in Slack, and
the agent resumes — generates copy for each platform (LinkedIn /
Twitter / Instagram), produces hero images at the right aspect ratios
via Nano Banana, renders any data-heavy posts as Manim animations,
self-critiques every image with Gemini vision (regenerate if scored
< 7/10), uploads the package to Google Drive, drafts each post to
Postiz, and emails the link.

That's a lot for a cron job to do. The point is: every one of those
steps is a tool already on your machine. The cloud schedulers can't
hit Google Drive as you, can't run Manim, can't open a stealth
browser. This one can, because it _is_ you.

## Configuration

Beyond what `main` already documents in `.env.example`:

| Variable | Used by | Notes |
|----------|---------|-------|
| `NANO_BANANA_API_KEY` | nanobanana skill | Already in `.env.example` on `main`. |
| `GEMINI_API_KEY` | acme-social agent (vision-based self-critique) | Set in `~/.claude/.env`; the agent reads it via `grep`. |
| `SERPAPI_KEY` | acme-social agent (YouTube trend lookups) | Same as above. |

The agent prompts reference `~/.claude/tools/social/` for helper
scripts (Google Trends fetcher, Reddit scraper, SerpAPI YouTube,
Veo video generator). Drop your own implementations there or adjust
the prompts to point at scripts you already have.

## Substituting your real brand

The agent files use placeholder brand identity:

- Brand name → search/replace `Acme Insights`
- Brand colors → `#10b981`, `#f97316`, `#8b5cf6`, `#06b6d4`, `#080c0a`
- Brand font → `Inter`
- Brand voice → see "Brand Context" and "Copy standards" sections of
  `agents/acme-social.md` and rewrite
- Logo description → currently a generic "compass mark"
- Owner email → `YOUR_EMAIL@example.com`

The pipeline shape (research → topic picks → multi-platform copy →
art-directed assets → self-critique → package → drafts) is the
reusable part.
