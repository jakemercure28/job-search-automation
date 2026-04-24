#!/bin/bash
# Only runs refresh when the dashboard is already up on its port.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT="${DASHBOARD_PORT:-3131}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO/logs/refresh.log"

mkdir -p "$REPO/logs"

NOW() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if ! nc -z localhost "$PORT" 2>/dev/null; then
  echo "$(NOW()) [refresh-if-dashboard] dashboard not reachable on port $PORT — skipping" >> "$LOG"
  exit 0
fi

echo "$(NOW()) [refresh-if-dashboard] dashboard detected on port $PORT — starting refresh" >> "$LOG"
cd "$REPO"
node scripts/refresh.js "$@" >> "$LOG" 2>&1
EXIT=$?
echo "$(NOW()) [refresh-if-dashboard] refresh exited ($EXIT)" >> "$LOG"
exit $EXIT
