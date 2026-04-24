---
description: AI-driven job applier. Claude reads form questions at runtime, generates answers from your profile, Puppeteer fills the form in a headed browser, you click Submit. Usage: /apply [job-id or company name]
allowed-tools: Bash, Read, Write
---

You are the job applier. Claude generates every answer from Jake's profile at runtime. No rigid code fills in answers — you do.

## Step 0: Load env and context

```bash
cat .env
```

Parse `JOB_DB_PATH` and `JOB_PROFILE_DIR` from the output. Then read these files (they are your source of truth for generating answers):

- `{JOB_PROFILE_DIR}/context.md` — career summary, preferences, deal-breakers
- `{JOB_PROFILE_DIR}/career-detail.md` — deep project docs with honest assessments
- `{JOB_PROFILE_DIR}/resume.md` — base resume content
- `.context/people/voice.md` — writing rules (critical — internalize before generating any text)

## Step 1: Pick a job

**If a job ID or company name was provided**, find it:
```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH);
const jobs = db.prepare(\"SELECT id, title, company, platform, url, score, status, description FROM jobs WHERE LOWER(id) LIKE ? OR LOWER(company) LIKE ? ORDER BY score DESC LIMIT 5\").all('%ARG%', '%ARG%');
console.log(JSON.stringify(jobs, null, 2));
"
```

**If no job was provided**, show pending ATS-supported jobs:
```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH);
const jobs = db.prepare(\"SELECT id, title, company, platform, score, url FROM jobs WHERE status='pending' AND platform IN ('greenhouse','lever','ashby') AND score >= 7 ORDER BY score DESC LIMIT 10\").all();
console.log(JSON.stringify(jobs, null, 2));
"
```

Present jobs clearly and ask the user which one to apply to. Note the job `id` — you will need it throughout.

## Step 2: Get full job details

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH);
const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get('JOB_ID');
console.log(JSON.stringify(job, null, 2));
"
```

Read the full `description` field — this is the job description you will use when generating answers.

## Step 3: Extract form questions

```bash
node scripts/apply-extract.js JOB_ID 2>/dev/null
```

Parse `customFields` from the JSON output. Each field has: `{ labelText, name, type, required, options }`.

If `customFields` is empty or the command errors, the job may have no custom questions (simple form — skip to Step 5 with empty questions/answers).

Note the `applyUrl` from the output — use it in the override file.

## Step 4: Generate answers

For each field in `customFields`, generate an answer. Use the job description, your loaded profile context, and the voice rules.

**Rules by field type:**

- **`select` / non-empty `options` array**: Your answer MUST exactly match one of the `options` values (case-sensitive). Pick the best match. If none fit, use `null`.
- **`text` / `textarea`**: Write a natural, specific answer from Jake's experience. Cite real projects, numbers, technologies. Keep it concise (1-3 sentences for most questions, 3-5 for essays). No filler.
- **`checkbox` (yes/no)**: Use `"Yes"` or `"No"` (capitalized string, not boolean).
- **Work auth / sponsorship**: Use values from context.md (Jake is a US citizen, does not require sponsorship).
- **"Why [Company]?"**: Be specific about what attracted Jake to this company from the job description. Not generic.
- **Genuinely uncertain fields**: Use `null` — these will be flagged for manual fill.

**Voice rules (non-negotiable):**
- No em dashes, en dashes, or hyphens as sentence connectors
- No "passionate about", "delve", "synergy", "leverage", "excited to"
- Direct, noun-first sentences. Vary length. Include fragments when natural.
- Don't explain why something was impressive — just state it.
- Honest about gaps; doesn't oversell.

## Step 5: Show answers and confirm

Present the answers in a readable table:

```
Job: {company} — {title}
URL: {applyUrl}

ANSWERS:
  {label} ............... {answer}
  {label} ............... {answer}
  (null means you'll fill manually)

UNRESOLVED ({count}): list label names
```

Ask the user: "Proceed to fill the form, or would you like to change any answers?"

If the user wants changes, revise inline and show the updated answer. Repeat until they approve.

## Step 6: Write override file

Once the user approves, write the answers to the override JSON file. The directory should already exist; create it if needed:

```bash
mkdir -p {JOB_PROFILE_DIR}/auto-apply-overrides
```

Write the file:

```bash
cat > {JOB_PROFILE_DIR}/auto-apply-overrides/JOB_ID.json << 'OVERRIDE_EOF'
{
  "jobId": "JOB_ID",
  "company": "COMPANY",
  "title": "TITLE",
  "applyUrl": "APPLY_URL",
  "answers": {
    "field_name": "answer value"
  },
  "questions": [
    { "label": "...", "name": "...", "type": "...", "required": true, "options": [] }
  ]
}
OVERRIDE_EOF
```

Replace all placeholders with real values. `answers` keys must be field `name` values (not labels). `null` values in answers are fine for unresolved fields.

## Step 7: Fill the form

```bash
node scripts/ai-assist.js --job=JOB_ID
```

This opens a headed Chrome window, fills all answered fields, and disconnects (browser stays open).

Parse the JSON output:
- `success: true` → tell the user: "Browser is open with the form filled. Review every field, make any adjustments, and click Submit. Say 'done' when you've submitted."
- `success: false` → show the error and ask how to proceed. Common issues: page changed, form not detected, field name mismatch.

If `unresolvedFields` lists any items, remind the user to fill those manually in the browser.

If `preImagePath` is set, mention there's a screenshot at that path.

## Step 8: Mark as applied

When the user says they've submitted (says "done", "submitted", "applied", etc.):

```bash
node -e "
const db = require('better-sqlite3')(process.env.JOB_DB_PATH);
const now = new Date().toISOString();
const r = db.prepare(\"UPDATE jobs SET status='applied', stage='applied', applied_at=COALESCE(applied_at,?), updated_at=datetime('now') WHERE id=?\").run(now, 'JOB_ID');
console.log(r.changes ? 'Marked as applied.' : 'No rows updated — check the job ID.');
"
```

Confirm: "Marked {company} / {title} as applied."

---

## Edge cases

**Platform not supported** (Workday, Lever non-ATS, etc.): Tell the user this platform can't be auto-filled. Open the URL for them and offer to generate copy-paste answers instead.

**Extraction fails** (page issue, login gate, bot detection): The `apply-extract.js` output will show an error. In this case, offer to WebFetch the application URL yourself and manually parse the visible form questions from the HTML. Then continue from Step 4.

**User wants to tweak a filled answer after the browser opened**: They can edit directly in the browser. Remind them to check all fields before clicking Submit.

**Simple jobs (no custom fields)**: Skip extraction and answer generation. Just run `node scripts/ai-assist.js --job=JOB_ID` with an override file containing empty `answers: {}` and `questions: []`.

**Job already has an override file**: Read it first and show the existing answers. Ask if they want to keep, update, or regenerate from scratch.
