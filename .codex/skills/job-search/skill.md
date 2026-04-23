---
description: Local MacBook job-search control surface. Use when asked to refresh jobs, review the queue, check progress, or open the dashboard. This skill is the primary daily entrypoint.
allowed-tools: Bash, Read
---

## Operating model

Assume one active local profile, resolved from `.env`:

- `JOB_PROFILE_DIR`
- `JOB_DB_PATH`
- `DASHBOARD_PORT`

Do not rely on SSH, an iMac, cron, or an always-on dashboard as the normal path.

## Daily commands

- Refresh jobs locally: `npm run refresh`
- Open the dashboard when needed: `npm start`
- Review the queue from SQLite with local commands
- Hand off actual submissions to the reviewed apply flow: `node scripts/auto-apply-cli.js apply --job=<job-id>`

## Review flow

1. Read `.env` and resolve the active profile.
2. Show local stats from the active SQLite DB.
3. Load the highest-signal pending jobs first.
4. If the user asks to refresh, run `npm run refresh`.
5. If the user wants the web UI, use `npm start` and point them to `http://localhost:${DASHBOARD_PORT:-3131}`.
6. If the user wants to submit, switch to the apply skill or run the local apply CLI.

## Useful local queries

Stats:

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
console.log(JSON.stringify({
  total: db.prepare('SELECT COUNT(*) c FROM jobs').get().c,
  pending: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='pending'\").get().c,
  highScore: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='pending' AND score >= 7\").get().c,
  applied: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='applied'\").get().c,
  responded: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='responded'\").get().c,
  rejected: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE stage='rejected'\").get().c,
  archived: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='archived' AND (stage IS NULL OR stage != 'rejected')\").get().c
}, null, 2));
"
```

High-scoring pending jobs:

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
const jobs = db.prepare(\"SELECT id, title, company, platform, location, url, score, reasoning FROM jobs WHERE status='pending' AND score >= 7 ORDER BY score DESC LIMIT 20\").all();
console.log(JSON.stringify(jobs, null, 2));
"
```

## Notes

- The dashboard is optional. SQLite is the source of truth either way.
- Raw scripts remain available, but `npm run refresh` is the standard local refresh action.
- Do not present scheduled wrappers as the default workflow.
