#!/bin/bash
set -e
# If node is not on PATH when running under cron/launchd, prepend its directory here:
#   export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

# Safely load a .env file — handles values with spaces without trying to
# execute words after the first space as shell commands (unlike `source`).
load_env() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[[:space:]]/}" ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [ -z "$key" ] && continue
    export "$key=$val"
  done < "$file"
}

# Scrape and run pipeline for each profile
# Each profile has its own companies.js (search terms + company lists)
# and its own DB, resume, and context files.
for profile_dir in profiles/*/; do
  if [ -f "$profile_dir/.env" ]; then
    profile=$(basename "$profile_dir")
    echo "[run-daily] ===== Profile: $profile ====="

    # Reset profile env vars, then load base + profile env
    unset JOB_PROFILE_DIR JOB_DB_PATH DASHBOARD_PORT
    load_env .env
    load_env "$profile_dir/.env"

    echo "[run-daily] Scraping for $profile..."
    node scraper.js

    echo "[run-daily] Running pipeline for $profile..."
    node pipeline.js

    echo "[run-daily] Checking description quality for $profile..."
    node scripts/check-descriptions.js || true

    echo "[run-daily] Checking for closed jobs for $profile..."
    node scripts/check-closed.js

    echo "[run-daily] Running market research for $profile..."
    node scripts/run-market-research.js || true

    echo "[run-daily] Retrying any pending unscored jobs for $profile..."
    node scripts/retry-unscored.js --limit=25 || true

    echo "[run-daily] Running auto-apply for $profile..."
    node scripts/run-auto-apply.js || true
  fi
done

# Validate ATS slugs (write slug-health.json for dashboard)
echo "[run-daily] Validating ATS slugs..."
node scripts/validate-slugs.js --broken-only || true

# Update .context/ files from DB and git history
echo "[run-daily] Updating context files..."
node scripts/update-context.js
