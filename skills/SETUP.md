# Skills Setup & Authentication

These skills are vendored into the repo for version control, but **no API keys
or tokens are committed** — auth lives outside source control. A fresh clone has
nothing to authenticate with, so image generation will fail with **HTTP 403**
until credentials are configured on that machine.

This is expected: keys were intentionally never put in version control.

## nanobanana

Google Gemini 3 Pro Image (`gemini-3-pro-image-preview`). This is the skill used
to produce the original Rivalytics logomark/brand assets.

**Requires:**

| Item | How to get / set it |
|------|---------------------|
| `GEMINI_API_KEY` env var | Create a key at <https://aistudio.google.com/apikey>, then `export GEMINI_API_KEY=...` in your shell profile (or pass `--api-key` to the script) |
| `google-genai`, `pillow` | `pip install google-genai pillow` |
| Python | 3.10+ |

Verify a machine is ready:

```bash
echo "${GEMINI_API_KEY:-NOT SET}"
python3 -c "import google.genai" || pip install google-genai pillow
```

Run a test asset:

```bash
IMAGE_OUTPUT_DIR=./test-assets \
  python3 skills/nanobanana/scripts/generate.py "your prompt here" -r 1:1 -s 2K
```

`-r` = aspect ratio (`1:1`, `16:9`, …), `-s` = size (`2K`/`4K`). Output dir
defaults to `./nanobanana-images`; override with `IMAGE_OUTPUT_DIR`.

### Troubleshooting 403

1. `GEMINI_API_KEY` unset in that machine's environment — most common cause.
2. Key invalid or expired — regenerate at Google AI Studio.
3. Google project unfunded / quota exhausted — check quota in AI Studio.
4. Region restriction, or `gemini-3-pro-image-preview` not enabled for the key.

## ai-image-generation

FLUX / Gemini / Grok / Seedream and 50+ models via the inference.sh CLI.

**Requires:**

| Item | How to get / set it |
|------|---------------------|
| `infsh` CLI | Install: <https://raw.githubusercontent.com/inference-sh/skills/refs/heads/main/cli-install.md> |
| inference.sh login | `infsh login` (stores a local token; not committed) |

Verify: `infsh whoami`. A 403 here means the CLI is not installed or not
logged in on that machine.

## Note on output

Generated images (`test-assets/`, `nanobanana-images/`) are gitignored —
they are build output, not source. Commit a sample deliberately only if it's
meant to serve as a reference asset.
