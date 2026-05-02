#!/bin/bash
# Only runs refresh when the dashboard is already up on its port.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT="${DASHBOARD_PORT:-3131}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO/logs/refresh"
LOG="$LOG_DIR/$(date +%Y%m%d).log"

mkdir -p "$LOG_DIR"

NOW() { date +"%Y-%m-%dT%H:%M:%S%z"; }

LOCK="/tmp/refresh-dashboard.lock"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "$(NOW) [refresh-if-dashboard] already running (pid $(cat "$LOCK")) — skipping" >> "$LOG"
  exit 0
fi
echo $$ > "$LOCK"
trap "rm -f '$LOCK'" EXIT

if ! nc -z localhost "$PORT" 2>/dev/null; then
  echo "$(NOW) [refresh-if-dashboard] dashboard not reachable on port $PORT — skipping" >> "$LOG"
  exit 0
fi

echo "$(NOW) [refresh-if-dashboard] dashboard detected on port $PORT — starting refresh" >> "$LOG"
cd "$REPO"
node scripts/refresh.js "$@" >> "$LOG" 2>&1
EXIT=$?
echo "$(NOW) [refresh-if-dashboard] refresh exited ($EXIT)" >> "$LOG"
exit $EXIT
