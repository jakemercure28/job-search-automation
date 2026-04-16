# Architecture Decisions

## Server-rendered HTML, no framework

The dashboard is pure server-rendered HTML with vanilla client-side JS. No React, Vue, or build step.

**Why:** This is a personal tool, not a product. Server rendering keeps it simple, fast to iterate on, and easy to debug. Adding a framework would add complexity for zero user benefit (you are the only user). HTML modules in `lib/html/` keep it organized without a build pipeline.

## SQLite for storage

Single-file database, no server process.

**Why:** The pipeline runs on a personal machine. SQLite is zero-config, backs up with a file copy, and handles the read/write volume (hundreds of jobs, not millions) with no overhead. Multi-profile support works by pointing each profile at its own `.db` file.

## Gemini Flash for scoring

Uses Google's Gemini Flash API for initial scoring.

**Why:** Gemini free tier (500 RPD) is enough for daily scoring for a single applicant at moderate volume. Structured output via JSON schema makes parsing trivial. Claude is a fine swap-in if you'd rather use the Anthropic API.

## Centralized FILTER_DEFS

All filter tab metadata (IDs, labels, colors, count keys) lives in a single `FILTER_DEFS` array in `lib/html/helpers.js`.

**Why:** Filter definitions used to be scattered across three files. Centralizing means adding a filter is a one-place config change plus the query in routes.

## Multi-profile via env vars

Profiles are isolated by environment variables, not by code branching.

**Why:** Multiple users (for example a couple or a small group sharing the pipeline) need completely separate DBs, resumes, and contexts but identical code. Env vars keep it DRY. Each profile has its own `.env` under `profiles/<name>/`, the `run-daily.sh` loops through all profiles, the scraper runs once (shared) and each profile scores against its own resume/context.

## Events table for audit trail

Every pipeline change (stage, outreach, archive) logged to an `events` table with timestamps.

**Why:** Without an audit trail, rejection analysis is impossible. The events table tracks days-to-rejection, posting age at application, and full pipeline history. Visible in the Analytics tab.

## Claude/Gemini rescore separation

The scorer is swappable. Keep the prompt in one place, the transport in another (`lib/gemini.js`).

**Why:** Easy to compare models or fall back to a second provider when one has an outage.

## Dashboard run mode

Dashboard runs as a long-lived local process (via LaunchAgent on macOS, systemd unit on Linux, or an always-on terminal). Scrapers run via host cron.

**Why:** A standalone process is simpler than any container or orchestration setup for a single-user pipeline. You can always wrap it later if you need to.

## Rejection likelihood reasoning on apply/reject

When a job is moved to `applied` or `rejected` stage, an async Gemini call fires in the background via `scoreRejectionLikelihood()` in `scorer.js`. Result stored in `rejection_reasoning` column. Dashboard shows `rejection_reasoning` over the original fit reasoning when it exists.

**Why:** Once applied, the fit-score reasoning ("why this is a good match") is less useful than knowing where the application is likely to fail.

## Profile files as source of truth

All career context, resume, experience details, and target company lists live in `profiles/<name>/`. `.context/` references them, never copies from them.
