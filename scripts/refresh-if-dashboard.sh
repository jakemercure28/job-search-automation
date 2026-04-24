#!/bin/bash
# Only runs refresh when the dashboard is already up on its port.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT="${DASHBOARD_PORT:-3131}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO/logs/refresh.log"

mkdir -p "$REPO/logs"

if ! lsof -ti :"$PORT" > /dev/null 2>&1; then
  echo "$(date): dashboard not running on port $PORT — skipping refresh" >> "$LOG"
  exit 0
fi

echo "$(date): dashboard detected, starting refresh" >> "$LOG"
cd "$REPO"
node scripts/refresh.js "$@" >> "$LOG" 2>&1
echo "$(date): refresh complete" >> "$LOG"
