---
description: Compatibility alias for the reviewed local apply workflow. Use when asked to prepare, review, or submit an application with explicit approval.
allowed-tools: Bash, Read
---

## Scope

Use this skill for application prep, CLI review, approved submission, receipts, and verification artifacts on the local MacBook checkout.

## Default workflow

1. Read `.env` to find `JOB_PROFILE_DIR` and `JOB_DB_PATH`.
2. Load the active profile context:
   - `{JOB_PROFILE_DIR}/context.md`
   - `{JOB_PROFILE_DIR}/career-detail.md`
   - `{JOB_PROFILE_DIR}/resume.md`
3. Use `node scripts/auto-apply-cli.js apply --job=<job-id>` for a single job.
4. Use `node scripts/auto-apply-cli.js apply` to pick the next eligible pending job.
5. Treat reviewed CLI apply as the main path:
   - generate prep and stored answers
   - print resolved and unresolved fields in the CLI
   - ask for explicit approval before submit
   - submit only after approval
   - record receipts, screenshots, and email-confirmation evidence
6. Do not use SSH or remote execution as part of the normal flow.

## Answer rules

- Prefer explicit overrides first.
- Then use deterministic ATS-safe defaults.
- Leave unresolved or low-confidence fields blank and surface them for review.
- Do not let broad heuristics overwrite an explicit answer.
- Keep work-auth and sponsorship questions distinct.

## When to submit

- Do not use unattended submission as the default path.
- If prep is not ready, return the unresolved fields and the override path instead of guessing.

## Dashboard behavior

- The dashboard is for browsing jobs and updating status, not for launching apply flows.
- Apply review and approval happen in the CLI.

## Receipts

Capture and preserve:
- apply URL
- resolved answers shown to the operator
- unresolved fields
- low-confidence fields
- screenshots
- email confirmation result
- page title, page URL, and short text snippet when detection fails

## Commands

- `node scripts/auto-apply-cli.js prepare --job=<job-id>`
- `node scripts/auto-apply-cli.js apply --job=<job-id>`
- `node scripts/auto-apply-cli.js show`
