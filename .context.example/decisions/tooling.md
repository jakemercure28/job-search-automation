# Tooling Decisions

## Node.js (CommonJS) for the pipeline

All code is Node 18+ CommonJS. No TypeScript, no ESM build step.

**Why:** Pipeline is <10K lines. Runtime type errors are rare and usually surface immediately. A type system and build step would be overhead for zero runtime benefit at this scale. Port to TypeScript once it stops fitting in one person's head.

## puppeteer-core + puppeteer-extra-plugin-stealth for scraping

Headless Chrome via `puppeteer-core` (no bundled Chromium; brings your own binary path). Stealth plugin to bypass common headless fingerprinting.

**Why:** Many ATS sites fingerprint default headless Chrome aggressively. Stealth plugin handles 90% of it. `puppeteer-core` keeps the install footprint small.

## better-sqlite3 over sqlite3

Synchronous API, faster for small workloads.

**Why:** The pipeline has no hot path that benefits from async DB access. Synchronous code is simpler to reason about. `better-sqlite3` is also genuinely faster for the kinds of transactions we do.

## imapflow for Gmail rejection sync

Modern IMAP client with promise-based API.

**Why:** Need IMAP because the app-password flow is the supported way to let a script read a personal Gmail without OAuth. `imapflow` is maintained and has a clean API.

## Gemini Flash 2.x for scoring

Free-tier friendly, structured output via JSON schema, good enough quality for this task.

**Why:** Cheap, fast, structured. Claude or GPT-4 would also work; the prompt is the hard part, not the model.

## Shell scripts for orchestration

`run-daily.sh` loops through profiles. `start-dashboard.sh` kills any stale port holder and starts the dashboard. No Makefile, no npm chains.

**Why:** Bash is zero-dependency and runs under any cron. npm scripts exist too, but bash is the cron-facing surface.
