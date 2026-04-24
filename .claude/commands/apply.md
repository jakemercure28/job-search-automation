---
description: Reviewed CLI application workflow for this repo. Use when asked to prepare, review, or submit an application with explicit approval.
---

Use the repo's reviewed local CLI apply workflow.

## Default workflow

1. Read `.env` to find `JOB_PROFILE_DIR` and `JOB_DB_PATH`.
2. Load the active profile context:
   - `{JOB_PROFILE_DIR}/context.md`
   - `{JOB_PROFILE_DIR}/career-detail.md`
   - `{JOB_PROFILE_DIR}/resume.md`
3. Use `node scripts/auto-apply-cli.js apply --job=<job-id>` for a single reviewed application.
4. Omit `--job` to let the CLI pick the highest-score eligible pending ATS job.
5. The flow should:
   - generate prep and stored answers
   - print resolved and unresolved fields in the CLI
   - ask for explicit approval before submit
   - submit only after approval
   - record receipts, screenshots, and email confirmation evidence

## Answer rules

- Prefer explicit overrides first.
- Then use deterministic ATS-safe defaults.
- Leave unresolved or low-confidence fields blank and surface them for review.
- Keep work-auth and sponsorship questions distinct.
- Do not let a generic heuristic overwrite an explicit answer.

## When to submit

- Do not use unattended submission as the default path.
- If prep is not ready, return the unresolved fields and the override path instead of guessing.
- Do not use SSH or remote execution as part of the supported workflow.

## Dashboard behavior

- The dashboard is for browsing jobs and updating status, not for launching apply flows.
- Apply review and approval happen in the CLI.

## Receipts

Capture and preserve:
- apply URL
- filled fields summary
- unresolved fields
- low-confidence fields
- screenshots
- page title, page URL, and short text snippet when detection fails
