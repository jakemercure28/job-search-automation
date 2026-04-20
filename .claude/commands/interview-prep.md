---
description: Generate phone screen prep notes from an email or job description. Finds the job in the DB, generates notes, saves them back. Usage: /interview-prep [paste email or job description]
allowed-tools: Bash, Read
---

You are generating phone screen prep notes. Follow these steps exactly.

## Step 1: Parse the input

Read `$ARGUMENTS`. Extract the company name and job title (if present).

## Step 2: Resolve profile

Read `.env` to find `JOB_DB_PATH` and `JOB_PROFILE_DIR`. Defaults: `JOB_DB_PATH=profiles/example/jobs.db`, `JOB_PROFILE_DIR=profiles/example`.

## Step 3: Find the job in the DB

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
const jobs = db.prepare(\"SELECT id, title, company, score, stage, interview_notes FROM jobs WHERE status != 'archived' ORDER BY score DESC\").all();
console.log(JSON.stringify(jobs, null, 2));
"
```

Match the company name from the input to a job. If multiple matches, pick the highest score or most recent. Show which job you matched and confirm before proceeding.

## Step 4: Get the full job record

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH || 'profiles/example/jobs.db');
const job = db.prepare(\"SELECT id, title, company, description, reasoning FROM jobs WHERE id=?\").get('MATCHED_ID');
console.log(JSON.stringify(job, null, 2));
"
```

## Step 5: Read the resume

Read `{JOB_PROFILE_DIR}/resume.md` (e.g. `profiles/example/resume.md`).

Also read `.context/people/applicant.md` for background on the applicant's preferences and deal breakers.

## Step 6: Generate prep notes

Using the job description, reasoning, and resume, generate reference notes in this exact format. Bullet points only, no prose, no scripts. Every bullet must contain a specific fact, number, or company name from the resume.

### Background
2-3 bullets. Most relevant experience and standout numbers that set up the call.

### Match Points
For each major requirement area in the job description, 1-2 bullets:
- **JD area**: Company: specific achievement with number

### Questions to Ask
5-6 specific questions based on what the JD implies or leaves out. Should show you read it carefully.

### Culture / Values
Only if the company lists named values. Map 2-3 to resume stories with numbers. Skip entirely if no named values.

### Comp
One bullet: listed range (or "not listed"), where the applicant lands, one-line reason.

## Step 7: Save notes to DB

Write notes to `/tmp/interview_notes.txt`, then:

```bash
python3 -c "
import sqlite3, os
notes = open('/tmp/interview_notes.txt').read()
db = sqlite3.connect(os.environ.get('JOB_DB_PATH', 'profiles/example/jobs.db'))
db.execute(\"UPDATE jobs SET interview_notes=?, updated_at=datetime('now') WHERE id=?\", (notes, 'MATCHED_ID'))
db.commit()
print('saved')
"
rm /tmp/interview_notes.txt
```

## Step 8: Confirm

Tell the user: job matched, notes saved, "View notes" button will appear on the dashboard. Show the full notes inline too.
