---
name: debug-prod
description: >
  Debug production job-search issues by connecting to the iMac (production DB).
  Use when the local DB is empty (MacBook is a GitHub clone), or when investigating
  dashboard bugs, salary tag issues, scoring problems, or any issue that requires
  real data. The iMac runs the live pipeline and holds the real jobs.db.
  Host is read from the $IMAC_HOST shell env var.
version: 1.1.0
allowed-tools: Bash, Read, Write, Edit
---

## Prereqs

- `$IMAC_HOST` exported in your shell (e.g. in `~/.zshrc`: `export IMAC_HOST=<tailscale-ip>`)
- `$IMAC_USER` exported (defaults to `$USER` if unset)
- SSH key authentication to the iMac set up (test with `ssh "$IMAC_USER@$IMAC_HOST" echo ok`).
  Do NOT use password auth — the Tailscale ACL should accept your machine's key.

## Production environment

- **Host**: `$IMAC_HOST`
- **SSH user**: `$IMAC_USER` (default: current user)
- **Repo path**: `~/job-search` on the iMac
- **DB path**: `~/job-search/profiles/user/jobs.db`
- **Dashboard**: `http://$IMAC_HOST:3131` (reachable over Tailscale)
- **Node path**: `/opt/homebrew/bin/node` (use `bash -l -c` to get it in PATH)

The local repo is a GitHub clone with an empty DB. Always use the iMac for production data debugging.

## How to connect

```bash
IMAC_USER="${IMAC_USER:-$USER}"

# Test connection
ssh "$IMAC_USER@$IMAC_HOST" "bash -l -c 'echo connected'"

# Run a node script from the job-search dir
ssh "$IMAC_USER@$IMAC_HOST" "bash -l -c 'cd ~/job-search && node -e \"console.log(require(\\\"better-sqlite3\\\")(\\\"profiles/user/jobs.db\\\").prepare(\\\"SELECT COUNT(*) c FROM jobs\\\").get())\"'"
```

For complex scripts, write to a local file and scp it over (avoids shell escaping nightmares):

```bash
IMAC_USER="${IMAC_USER:-$USER}"

# Write script locally
cat > /tmp/debug-script.js << 'EOF'
const db = require('better-sqlite3')('profiles/user/jobs.db');
// ... your query ...
EOF

# Copy and run
scp /tmp/debug-script.js "$IMAC_USER@$IMAC_HOST:~/job-search/debug-script.js"
ssh "$IMAC_USER@$IMAC_HOST" "bash -l -c 'cd ~/job-search && node debug-script.js && rm debug-script.js'"
```

## After fixing code locally

Push the fix to main, then pull and restart on the iMac. Normally the GitHub Actions `deploy.yml` workflow handles this automatically on merge to main — the steps below are only needed for out-of-band hotfixes.

```bash
IMAC_USER="${IMAC_USER:-$USER}"

# Local: commit and push
git add <files> && git commit -m "fix: ..." && git push origin main

# Then pull and restart on iMac
ssh "$IMAC_USER@$IMAC_HOST" "bash -l -c 'cd ~/job-search && git pull && launchctl kickstart -k gui/\$(id -u)/com.user.job-search-dashboard'"
```

## Common debug queries

```javascript
// Count jobs by status
db.prepare("SELECT status, COUNT(*) c FROM jobs GROUP BY status").all()

// Recent events
db.prepare("SELECT e.event_type, e.created_at, j.company, j.title FROM events e JOIN jobs j ON e.job_id=j.id ORDER BY e.created_at DESC LIMIT 20").all()

// Jobs with score issues
db.prepare("SELECT company, title, score FROM jobs WHERE score IS NULL ORDER BY created_at DESC LIMIT 20").all()
```
