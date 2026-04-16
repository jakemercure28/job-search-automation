# Claude Instructions

This repo is a personal job-search automation pipeline. It scrapes job boards, scores listings with an LLM, serves a local dashboard, and can auto-apply to simple applications.

## Context system

`.context/` is the persistent context layer for Claude Code. It tells Claude what exists and where to find it. The source of truth for career data lives in `profiles/<active-profile>/`.

The repo ships an example copy at `.context.example/`. To use it, run:

```bash
cp -r .context.example .context
cp -r profiles/example profiles/your-name
```

Then edit both to reflect you. `.context/` and profiles other than `example/` are gitignored.

**At session start, always read:**
- `.context/people/applicant.md` — who the applicant is, working preferences
- `.context/people/voice.md` — writing rules (critical for anything in the applicant's voice)

**When working in the pipeline code, also read:**
- `.context/projects/job-search.md` — architecture, features, multi-profile setup
- `.context/reference/dashboard-files.md` — file map for what to edit
- `.context/decisions/architecture.md` — why things are built this way

**When doing interview prep, outreach, or application work, also read:**
- `profiles/<active>/context.md` — full career context, preferences, deal breakers
- `profiles/<active>/career-detail.md` — deep project documentation with honest assessments
- `profiles/<active>/experience/*.md` — per-company experience files
- `.context/reference/interviews.md` — interview patterns and learnings

**When answering application questions or writing cover letters: write the answer first, analysis after.** Don't evaluate the role or editorialize before drafting the answer. If there are concerns about fit, put them after.

## Writing rules (applies to ALL output)

**Never use em dashes, en dashes, or hyphens as sentence connectors.** Rewrite with a comma or period instead. No exceptions, anywhere in the output.

## Git workflow

Prefer small, reviewable commits with clear messages. Stage only files relevant to the task.

**Never commit:**
- `jobs.json` (auto-generated)
- `jobs.db` (per-profile SQLite)
- `.env` files
- Auto-generated build artifacts (`*.pdf`, `public/bookmarklet.js`)
- `market-research-cache.json`, `slug-health.json`, or any `*-cache.json`
- Personal content under `.context/` or `profiles/<your-name>/` (both gitignored)
