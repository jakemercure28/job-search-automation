#!/bin/bash
set -euo pipefail

# Kill any process already holding the dashboard port before starting.
# DASHBOARD_PORT defaults to 3131 (see config/constants.js).
PORT="${DASHBOARD_PORT:-3131}"
OLD_PID="$(lsof -ti :$PORT 2>/dev/null || true)"
if [ -n "$OLD_PID" ]; then
  kill -9 $OLD_PID 2>/dev/null
  sleep 1
fi

cd "$(dirname "$0")/.."
exec node dashboard.js
