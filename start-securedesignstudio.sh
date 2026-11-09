#!/bin/sh
# Starts SecureDesignStudio for ordinary modeling, with no AI and no cloud account
# on macOS and Linux. Counterpart of Start-SecureDesignStudio.ps1; the checks live in
# scripts/launch.mjs, shared with 'npm run start'. Run with --help for options.
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "" "MISSING PREREQUISITE: Node.js" "" \
    "Install Node.js 24 LTS with a version manager (nvm install 24, fnm install 24)," \
    "your package manager, or https://nodejs.org/, then open a new terminal and" \
    "run this again." "" >&2
  exit 1
fi
exec node scripts/launch.mjs "$@"
