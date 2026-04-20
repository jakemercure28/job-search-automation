#!/bin/bash
set -e

# Backs up sensitive files (DB, context, profile, env) to a private git repo.
# Set BACKUP_REPO_PATH in .env to the local path of your private backup repo.

cd "$(dirname "$0")/.."

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

load_env .env

if [ -z "$BACKUP_REPO_PATH" ]; then
  echo "[backup] BACKUP_REPO_PATH not set in .env — skipping backup"
  exit 0
fi

if [ ! -d "$BACKUP_REPO_PATH/.git" ]; then
  echo "[backup] ERROR: $BACKUP_REPO_PATH is not a git repo"
  exit 1
fi

DEST="$BACKUP_REPO_PATH"

echo "[backup] Syncing to $DEST..."

# .context/ (all context files)
rsync -a --delete .context/ "$DEST/.context/"

# profiles/ (all profiles except example)
mkdir -p "$DEST/profiles"
for profile_dir in profiles/*/; do
  profile=$(basename "$profile_dir")
  [ "$profile" = "example" ] && continue
  rsync -a --delete "$profile_dir" "$DEST/profiles/$profile/"
done

# root .env
cp .env "$DEST/.env"

# Commit and push
cd "$DEST"
git add -A

if git diff --cached --quiet; then
  echo "[backup] Nothing changed, skipping commit"
  exit 0
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
git commit -m "backup: $TIMESTAMP"
git push

echo "[backup] Done"
