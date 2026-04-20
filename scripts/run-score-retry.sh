#!/bin/bash
set -e
# If node is not on PATH when running under cron/launchd, prepend its directory here:
#   export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

for profile_dir in profiles/*/; do
  if [ -f "$profile_dir/.env" ]; then
    profile=$(basename "$profile_dir")
    echo "[score-retry] ===== Profile: $profile ====="

    unset JOB_PROFILE_DIR JOB_DB_PATH DASHBOARD_PORT
    set -a
    source .env
    source "$profile_dir/.env"
    set +a

    node scripts/retry-unscored.js --limit=25 || true
  fi
done
