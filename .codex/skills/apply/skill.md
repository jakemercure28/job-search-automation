---
name: apply
description: Reviewed local CLI workflow for direct job-application requests. Use when asked to apply to a specific job, submit an application, or apply to the next eligible pending job. Prepare answers in the CLI, surface unresolved or low-confidence fields, require explicit approval before submit, preserve receipts and screenshots, and keep execution on the local MacBook checkout.
---

# Apply

Use this skill as the primary entry point for direct apply and submit requests in this repo.

## Workflow

1. Read `.env` and resolve the active profile from `JOB_PROFILE_DIR` and `JOB_DB_PATH`.
2. Load active profile context only when needed:
   - `{JOB_PROFILE_DIR}/context.md`
   - `{JOB_PROFILE_DIR}/career-detail.md`
   - `{JOB_PROFILE_DIR}/resume.md`
3. Use `node scripts/auto-apply-cli.js apply --job=<job-id>` when the user names a job.
4. Use `node scripts/auto-apply-cli.js apply` when the user wants the next eligible pending supported job.
5. Use `node scripts/auto-apply-cli.js prepare --job=<job-id>` when you need the review payload without submitting.
6. Review resolved answers, unresolved fields, and low-confidence fields before any submit step.
7. Submit only after explicit approval from the user. Use `--yes` only after that approval is already established.
8. Keep execution local. Do not use SSH, remote execution, or the dashboard as the normal apply path.

## Answer Rules

- Prefer explicit overrides first.
- Then use deterministic ATS-safe defaults.
- Leave ambiguous, unresolved, or low-confidence fields blank and surface them for review.
- Do not let broad heuristics overwrite an explicit answer.
- Keep work authorization and sponsorship questions distinct.

## When To Stop

- Do not submit unattended by default.
- If prep is not ready, return the unresolved fields and the override path instead of guessing.
- If a question is ambiguous or unsupported, stop at review and ask for approval or missing inputs.

## Receipts

Capture and preserve:

- apply URL
- resolved answers shown in review
- unresolved fields
- low-confidence fields
- screenshots
- email-confirmation result
- page title, page URL, and short text snippet when verification fails

## Commands

- `node scripts/auto-apply-cli.js prepare --job=<job-id>`
- `node scripts/auto-apply-cli.js apply --job=<job-id>`
- `node scripts/auto-apply-cli.js apply`
- `node scripts/auto-apply-cli.js show`
