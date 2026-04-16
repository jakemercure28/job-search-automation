# Job Search Pipeline

An end-to-end automation pipeline for a technical job search. Scrapes 11 ATS platforms, scores each listing with an LLM against your resume and context files, classifies applications by complexity, auto-fills simple ones, and serves a local dashboard for human review and pipeline tracking. IMAP integration syncs rejection emails back into the DB automatically.

Designed for a single applicant (or a small group sharing one machine), not as a SaaS. The point is to get the benefits of a structured pipeline without spinning up infrastructure for it.

## Architecture

```
                       +----------------+
  cron / launchd  ---> |  run-daily.sh  |
                       +----------------+
                               |
               +---------------+---------------+
               v                               v
      +-----------------+            +-----------------+
      |   scraper.js    |            |  per-profile    |
      | (11 platforms)  |            |  run            |
      +--------+--------+            +--------+--------+
               |                              |
               v                              v
        jobs.json (tmp)                pipeline.js
                                              |
                              +---------------+-------------------+
                              v               v                   v
                      dedupe & insert    scorer.js         classifyComplexity
                      into SQLite        (Gemini)          (simple vs complex)
                              |               |                   |
                              +---------------+-------------------+
                                              |
                                              v
                                   +----------------------+
                                   |      jobs.db         |
                                   |  (per-profile)       |
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+
                                   |    dashboard.js      |  <---- you (localhost)
                                   | (server-rendered)    |
                                   +----------+-----------+
                                              |
                           +------------------+--------------------+
                           v                                       v
                 +------------------+                 +---------------------+
                 | auto-applier     |                 | application-prep    |
                 | (Greenhouse /    |                 | (complex forms,     |
                 |  Lever / Ashby)  |                 |  LLM-drafted        |
                 |                  |                 |  answers)           |
                 +------------------+                 +---------------------+
                           |                                       |
                           +-----------------+---------------------+
                                             |
                                             v
                                  +----------------------+
                                  |   rejection email    |
                                  |   sync via IMAP      |
                                  +----------------------+
```

## Tech stack

- **Node.js 18+** (CommonJS), zero build step
- **better-sqlite3** for per-profile job storage
- **puppeteer-core + puppeteer-extra-plugin-stealth** for ATS form submission
- **Google Gemini Flash** for scoring, complexity classification, and application prep
- **imapflow** for inbox rejection sync
- **Server-rendered HTML** dashboard with vanilla client-side JS

## Features

### Multi-source scraping

Pulls from Greenhouse, Lever, Ashby, Workable, Workday, Wellfound, Built In, Rippling, RemoteOK, Jobicy, Arbeitnow, and WeWorkRemotely. Company slugs configured per profile, global boards filtered by search terms. Respectful rate limits and User-Agent.

### LLM scoring with post-processing

Gemini scores each job 1-10 along five dimensions (stack match, seniority, comp, company stage, desirability). Scores are post-processed deterministically to cap mis-rated roles (for example, roles requiring 8+ YOE cap at 3 regardless of prompt output).

### Application complexity classifier

Each scored job is tagged `simple` or `complex`. Simple jobs go to the headless-browser auto-applier. Complex jobs surface in the dashboard with LLM-drafted answers ready for human review.

### Voice-aware LLM drafting

All answers generated for applications pass through a voice check (`lib/voice-check.js`) that flags em dashes, corporate buzzwords, and AI-flavored sentence structure. Flagged answers can be rewritten by the LLM with the issues highlighted.

### Dashboard

Server-rendered HTML (no framework, no build step) on `localhost:3131`. Filter tabs, pipeline tracking (Applied → Phone Screen → Interview → Onsite → Offer / Rejected), market research analytics, company notes, and interview prep notes attached to each job.

### Rejection email sync

Every 5 minutes, the dashboard IMAPs your Gmail, pattern-matches rejection emails against known applied jobs, and flips their stage to `rejected` with the rejection reason parsed out.

### Multi-profile support

Multiple applicants on one machine (a couple, say) run isolated pipelines by pointing `JOB_PROFILE_DIR` and `JOB_DB_PATH` at different directories. `run-daily.sh` loops through all profiles automatically.

## Design decisions

A few things worth flagging:

- **No framework, no build step.** The dashboard is server-rendered HTML with a single CSS file. This is a personal tool, not a product. Adding Next.js buys nothing.
- **SQLite over any server DB.** The pipeline runs on one machine. A single-file DB is zero-config, backs up with `cp`, and handles the workload trivially.
- **File-based context over vector DB.** LLM calls read `resume.md`, `context.md`, and `career-detail.md` directly. A vector DB would add complexity for a corpus that fits in a prompt.
- **Env-var profile isolation.** `JOB_PROFILE_DIR` and `JOB_DB_PATH` keep profiles apart. No code branching, no per-profile if-statements.
- **Events table for audit trail.** Every pipeline state change is logged, which makes rejection analysis (days-to-rejection, posting age on apply) tractable.

More detail in `.context.example/decisions/`.

## Setup

```bash
git clone <this-repo>
cd job-search

# 1. Dependencies
npm install

# 2. Config
cp .env.example .env
# then fill in:
#   - GEMINI_API_KEY (https://aistudio.google.com/apikey)
#   - APPLICANT_* fields for your identity
#   - GMAIL_EMAIL / GMAIL_APP_PASSWORD (optional; for rejection sync)

# 3. Profile scaffolding
cp -r profiles/example profiles/your-name
# edit profiles/your-name/resume.md, context.md, career-detail.md, companies.js

# 4. Context scaffolding (for LLM grounding)
cp -r .context.example .context
# edit .context/people/applicant.md, voice.md as appropriate

# 5. Update .env to point at your profile
#   JOB_PROFILE_DIR=profiles/your-name
#   JOB_DB_PATH=profiles/your-name/jobs.db

# 6. First run
npm run daily
npm start            # dashboard on http://localhost:3131
```

## Common commands

```bash
npm run daily              # full pipeline: scrape → pipeline → retry
npm run scrape             # scrape only
npm run pipeline           # pipeline only (uses current jobs.json)
npm run score              # rescore unscored jobs
npm run retry-unscored     # retry jobs that failed scoring
npm run sync-rejections    # manual one-shot of rejection email sync
npm run auto-apply         # run unattended apply loop (respects AUTO_APPLY_ENABLED)
npm run resume             # regenerate resume.pdf from resume.md
npm run build:bookmarklet  # build the auto-fill bookmarklet from your env
npm test                   # run the node test suite
```

## Scheduling

Suggested cron entries:

```
7 8 * * *    cd /path/to/job-search && bash run-daily.sh      >> /tmp/job-search.log 2>&1
7 14 * * *   cd /path/to/job-search && bash run-daily.sh      >> /tmp/job-search.log 2>&1
30 * * * *   cd /path/to/job-search && bash run-score-retry.sh >> /tmp/job-search-score-retry.log 2>&1
```

Under launchd on macOS, a `KeepAlive`-enabled LaunchAgent running `start-dashboard.sh` keeps the UI alive across reboots.

## Extending

**New ATS platform:** add a `scrapers/<name>.js` module that exports `scrape<Name>()` and returns an array of job objects matching the schema in existing scrapers. Wire it into `scraper.js`.

**New filter tab:** add to `FILTER_DEFS` in `lib/html/helpers.js`, add a corresponding query in `filterQueries` in `lib/dashboard-routes.js`.

**New auto-apply platform:** add `lib/ats-appliers/<name>.js` exporting `submit<Name>()`. Wire it into `lib/auto-applier.js`.

**Scoring calibration:** edit the prompt in `scorer.js`. Deterministic caps live in `scoreJob()`; use those for "never over-score this pattern" rules the LLM keeps rationalizing past.

## Disclaimer

This is a personal project. Scrapers hit public job-board endpoints and respect typical rate-limit and User-Agent conventions. Before running at scale, review each site's Terms of Service. Automated form submission against ATS platforms can trigger spam filtering; `AUTO_APPLY_PLATFORM_BLOCKLIST` exists specifically to skip platforms where this has been an issue.

Use responsibly. Not a guarantee of interviews, offers, or anything else.
