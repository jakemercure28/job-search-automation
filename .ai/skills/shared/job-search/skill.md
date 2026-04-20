---
description: Review pending job listings, approve/reject them, check stats, run the pipeline. Use when asked to "review jobs", "show job matches", "approve/reject jobs", "find me jobs", "run job search", or similar. The scraper runs automatically on a daily schedule. This skill is for reviewing and managing those results interactively.
allowed-tools: Bash, Read
---

## Step 0: Resolve profile

Read `.env` to find `JOB_DB_PATH` and `DASHBOARD_PORT`. If `.env` is missing, default to `JOB_DB_PATH=profiles/example/jobs.db` and `DASHBOARD_PORT=3131`.

## Step 1: Stats

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
console.log(JSON.stringify({
  total:     db.prepare('SELECT COUNT(*) c FROM jobs').get().c,
  pending:   db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='pending'\").get().c,
  highScore: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='pending' AND score >= 7\").get().c,
  applied:   db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='applied'\").get().c,
  responded: db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='responded'\").get().c,
  rejected:  db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE stage='rejected'\").get().c,
  archived:  db.prepare(\"SELECT COUNT(*) c FROM jobs WHERE status='archived' AND (stage IS NULL OR stage != 'rejected')\").get().c,
  lastRun:   db.prepare(\"SELECT MAX(created_at) c FROM jobs\").get().c,
}, null, 2));
"
```

Show stats clearly. Note how many high-scoring (7+) pending jobs await review.

## Step 2: Load pending jobs

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
const jobs = db.prepare(\"SELECT id, title, company, platform, location, url, score, reasoning FROM jobs WHERE status='pending' AND score >= 7 ORDER BY score DESC LIMIT 20\").all();
console.log(JSON.stringify(jobs, null, 2));
"
```

## Step 3: Review one at a time

Present each job and wait for a reply before moving on:

```
[{score}/10] {title}
{company} · {platform} · {location}
{url}

{reasoning}

approve / reject / skip / stop
```

After each reply, update the DB immediately:

- `approve` / `yes` / `y` → set `status='applied'`:
```bash
node -e "require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db').prepare(\"UPDATE jobs SET status='applied', applied_at=COALESCE(applied_at, datetime('now')), updated_at=datetime('now') WHERE id=?\").run('JOB_ID');"
```

- `reject` / `no` / `n` → set `status='archived'`, `stage='rejected'`:
```bash
node -e "require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db').prepare(\"UPDATE jobs SET status='archived', stage='rejected', rejected_at=datetime('now'), updated_at=datetime('now') WHERE id=?\").run('JOB_ID');"
```

- `archive` / `a` → set `status='archived'` (no stage):
```bash
node -e "require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db').prepare(\"UPDATE jobs SET status='archived', updated_at=datetime('now') WHERE id=?\").run('JOB_ID');"
```

- `skip` / `s` → stay `pending`, move on
- `stop` → end loop, go to Step 4

Batch commands like "reject all below 6" or "approve all 9s" are fine — handle with a single UPDATE.

## Step 4: Summary

Show: approved / rejected this session, pending remaining, dashboard link at `http://localhost:${DASHBOARD_PORT:-3131}`.

---

## Other things the user might ask

**"run the pipeline now"** — run in background:
```bash
/bin/zsh ./run-daily.sh >> /tmp/job-search.log 2>&1 &
echo "Running. Check /tmp/job-search.log for progress."
```

**"what have I applied to":**
```bash
node -e "const db=require('better-sqlite3')(process.env.JOB_DB_PATH||'profiles/example/jobs.db');console.log(JSON.stringify(db.prepare(\"SELECT title,company,url,status,updated_at FROM jobs WHERE status IN ('applied','responded') ORDER BY updated_at DESC\").all(),null,2));"
```

**"mark [Company] as responded":** find job by company name, update `status='responded'`.

**"show archived":**
```bash
node -e "const db=require('better-sqlite3')(process.env.JOB_DB_PATH||'profiles/example/jobs.db');console.log(JSON.stringify(db.prepare(\"SELECT title,company,url,score,updated_at FROM jobs WHERE status='archived' ORDER BY updated_at DESC\").all(),null,2));"
```

**"unarchive [Company]":** find job by company name, update `status='pending'`.

**"reject all below 6":**
```bash
node -e "const r=require('better-sqlite3')(process.env.JOB_DB_PATH||'profiles/example/jobs.db').prepare(\"UPDATE jobs SET status='archived', stage='rejected', rejected_at=datetime('now'), updated_at=datetime('now') WHERE status='pending' AND score < 6\").run();console.log('rejected '+r.changes);"
```
