#!/usr/bin/env bash
# Daily sync: pull agent-workbench, symlink new agents into ~/.claude/agents/,
# and restart the Winston router if anything changed.
#
# Safe to run by hand any time.
set -euo pipefail

WORKBENCH="${WORKBENCH:-$HOME/projects/agent-workbench}"
CLAUDE_AGENTS="$HOME/.claude/agents"
LOG="$HOME/Library/Logs/winston-sync-agents.log"

# Subdirectories of agent-workbench/agents/ whose .md files we expose to Winston.
# Add more here when new agent collections come online.
INCLUDED_SUBDIRS=(codephil rivalytics)

UID_NUM="$(id -u)"
ROUTER_LABEL="com.winston.router"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

mkdir -p "$CLAUDE_AGENTS" "$(dirname "$LOG")"
log "----- sync start -----"

if [[ ! -d "$WORKBENCH/.git" ]]; then
  log "ERROR: $WORKBENCH is not a git repo; aborting"
  exit 1
fi

cd "$WORKBENCH"
branch="$(git rev-parse --abbrev-ref HEAD)"
before="$(git rev-parse HEAD)"
pulled=0

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "uncommitted changes in $WORKBENCH on $branch — skipping pull"
else
  if git pull --ff-only origin "$branch" >> "$LOG" 2>&1; then
    pulled=1
  else
    log "ERROR: git pull --ff-only origin $branch failed; continuing without pull"
  fi
fi

after="$(git rev-parse HEAD)"
changed=0
if [[ "$pulled" -eq 1 && "$before" != "$after" ]]; then
  changed=1
  log "pulled $before..$after on $branch"
  git diff --name-only "$before" "$after" -- agents/ 2>/dev/null | sed 's/^/  changed: /' >> "$LOG" || true
fi

# Ensure every .md file in INCLUDED_SUBDIRS is symlinked into ~/.claude/agents/.
new_links=0
for sub in "${INCLUDED_SUBDIRS[@]}"; do
  dir="$WORKBENCH/agents/$sub"
  [[ -d "$dir" ]] || continue
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    name="$(basename "$f")"
    target="$CLAUDE_AGENTS/$name"
    if [[ -L "$target" ]]; then
      # Already a symlink — leave it (preserves any manual override).
      continue
    fi
    if [[ -e "$target" ]]; then
      log "skip $name: $target exists and is not a symlink"
      continue
    fi
    ln -s "$f" "$target"
    log "linked $name -> $f"
    new_links=$((new_links + 1))
    changed=1
  done < <(find "$dir" -maxdepth 1 -type f -name '*.md' | sort)
done

if [[ "$changed" -eq 1 ]]; then
  log "restarting $ROUTER_LABEL (new_links=$new_links, pulled=$pulled)"
  if launchctl kickstart -k "gui/$UID_NUM/$ROUTER_LABEL" >> "$LOG" 2>&1; then
    log "router restarted"
  else
    log "WARN: launchctl kickstart failed"
  fi
else
  log "no changes"
fi

log "----- sync end -----"
