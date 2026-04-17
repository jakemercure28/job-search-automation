---
name: debug-prod
description: >
  Debug production job-search issues by connecting to the iMac (production DB).
  Use when the local DB is empty (the checkout is a fresh GitHub clone), or when
  investigating dashboard bugs, salary tag issues, scoring problems, or any issue
  that requires real data. The iMac runs the live pipeline and holds the real jobs.db.
  Connects via the `imac-server` SSH host alias defined in ~/.ssh/config.
version: 1.1.0
allowed-tools: Bash, Read, Write, Edit
---

## Prereqs

- `imac-server` Host entry in `~/.ssh/config` with HostName, User, and IdentityFile set.
  Test it: `ssh imac-server echo ok` should print `ok` with no password prompt.
- `$IMAC_HOST` exported in your shell (for dashboard URLs only — e.g. in `~/.zshrc`:
  `export IMAC_HOST=<tailscale-ip>`). The SSH alias handles auth.
- Do NOT use password auth. Key-based auth only.

## Production environment

- **SSH target**: `imac-server` (alias in ~/.ssh/config)
- **Repo path**: `~/job-search-automation` on the iMac
- **DB path**: `~/job-search-automation/profiles/user/jobs.db` (adjust if your profile dir differs)
- **Dashboard**: `http://$IMAC_HOST:3131` (reachable over Tailscale)
- **Node path**: `/opt/homebrew/bin/node` (use `bash -l -c` to get it in PATH)

The local repo is a GitHub clone with an empty DB. Always use the iMac for production data debugging.

## How to connect

```bash
# Test connection
ssh imac-server "bash -l -c 'echo connected'"

# Run a node script from the repo dir
ssh imac-server "bash -l -c 'cd ~/job-search-automation && node -e \"console.log(require(\\\"better-sqlite3\\\")(\\\"profiles/user/jobs.db\\\").prepare(\\\"SELECT COUNT(*) c FROM jobs\\\").get())\"'"
```

For complex scripts, write to a local file and scp it over (avoids shell escaping nightmares):

```bash
cat > /tmp/debug-script.js << 'EOF'
const db = require('better-sqlite3')('profiles/user/jobs.db');
// ... your query ...
EOF

scp /tmp/debug-script.js imac-server:~/job-search-automation/debug-script.js
ssh imac-server "bash -l -c 'cd ~/job-search-automation && node debug-script.js && rm debug-script.js'"
```

## After fixing code locally

Merging to `main` auto-deploys via the `deploy.yml` GitHub Actions workflow. The manual
steps below are only needed for out-of-band hotfixes (e.g. CI is down).

```bash
# Local: commit and push
git add <files> && git commit -m "fix: ..." && git push origin main

# Then pull and restart on iMac (uses IMAC_SERVICE from env; fall back to the alias below)
ssh imac-server "bash -l -c 'cd ~/job-search-automation && git pull && launchctl kickstart -k gui/\$(id -u)/\$IMAC_SERVICE'"
```

If `$IMAC_SERVICE` is not in the iMac's shell env, substitute the actual launchd service name.

## Common debug queries

```javascript
// Count jobs by status
db.prepare("SELECT status, COUNT(*) c FROM jobs GROUP BY status").all()

// Recent events
db.prepare("SELECT e.event_type, e.created_at, j.company, j.title FROM events e JOIN jobs j ON e.job_id=j.id ORDER BY e.created_at DESC LIMIT 20").all()

// Jobs with score issues
db.prepare("SELECT company, title, score FROM jobs WHERE score IS NULL ORDER BY created_at DESC LIMIT 20").all()
```
