#!/bin/bash
# SessionStart hook for Claude Code on the web: installs npm dependencies so
# lint / typecheck / vitest / build work in the cloud review pipeline
# (see .claude/skills/review-pipeline/SKILL.md). No-op on local machines.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# The cloud image ships Chromium for Playwright; never download another one.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# `npm install` (not `npm ci`) reuses the cached node_modules; `--no-save` keeps the
# local npm from rewriting package-lock.json, which would pollute every review diff.
npm install --no-save --no-audit --no-fund --loglevel=error

# Persist for the rest of the session's shell commands.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
  echo 'export NEXT_TELEMETRY_DISABLED=1' >> "$CLAUDE_ENV_FILE"
fi
