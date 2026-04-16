# Job Search Pipeline

Automated job scraping, LLM scoring, and a local dashboard for managing applications. Supports multiple profiles (one per applicant).

## Architecture

Three stages: **scrape, score, serve.**

### Scrape (`scraper.js`)

Multi-platform job scraper. Runs daily via cron. Pulls from Greenhouse, Lever, Ashby, Workday, Workable, Wellfound, Built In, RemoteOK, Jobicy, Arbeitnow, WeWorkRemotely. Target companies defined per profile in `profiles/<name>/companies.js`. Output goes to `jobs.json` (never committed).

### Score (`pipeline.js` + `scorer.js`)

Uses Google Gemini Flash to:
- Score each job 1 to 10 against the active profile's resume and context
- Detect application complexity (simple or complex)
- Generate reasoning explanations
- Draft outreach messages on demand

### Serve (`dashboard.js`)

HTTP dashboard on a configurable port (default 3131). Server-rendered HTML, no framework, no build step. Client-side JS for interactivity (modals, pipeline changes, search/filter).

## Multi-profile support

Isolated profiles via env vars:
- `JOB_DB_PATH` — path to SQLite database (default `profiles/<active>/jobs.db`)
- `DASHBOARD_PORT` — dashboard HTTP port (default 3131)
- `JOB_PROFILE_DIR` — directory containing `resume.md` and `context.md`

Each profile has its own `.env` in `profiles/<name>/`. The `run-daily.sh` loops through all profiles. Scraper runs once (shared), then each profile scores against its own resume/context.

## Key features

- Filter tabs: All, Not Applied, Applied, Follow-up, Interviewing, Need Outreach, Quick Apply, Rejected, Analytics, Archived
- Filter definitions centralized in `FILTER_DEFS` in `lib/html/helpers.js`
- Pipeline tracking (Applied → Phone Screen → Interview → Onsite → Offer / Rejected)
- AI-drafted outreach and follow-up messages
- Interview prep notes
- Rejection analysis with transcript attachment
- Company tags and notes
- Auto-fill bookmarklet for Greenhouse, Ashby, Lever forms
- Analytics: pipeline funnel and score calibration

## Profile source files

All of the applicant's career context, resume, experience details, and target company lists live in `profiles/<name>/`. These files are the source of truth for scoring, outreach drafting, and interview prep.
