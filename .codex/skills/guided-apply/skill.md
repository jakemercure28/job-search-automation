---
description: Compatibility alias for the reviewed local apply workflow. Use when asked to prepare, review, or submit an application with explicit approval.
allowed-tools: Bash, Read
---

## Scope

Use this skill for application prep, answer review, approved submission, receipts, and verification artifacts on the local MacBook checkout.

## Default workflow

1. Read `.env` to find `JOB_PROFILE_DIR` and `JOB_DB_PATH`.
2. Load the active profile context:
   - `{JOB_PROFILE_DIR}/context.md`
   - `{JOB_PROFILE_DIR}/career-detail.md`
   - `{JOB_PROFILE_DIR}/resume.md`
3. Use `node scripts/apply-extract.js <job-id>` to extract the custom application questions for one job.
4. Draft answers in the applicant's voice and save them to `/tmp/apply-answers-<job-id>.json`.
5. Treat reviewed local apply as the main path:
   - generate extracted questions first
   - review the final answers JSON with the user
   - ask for explicit approval before submit
   - submit only after approval
   - record screenshots and receipt-log evidence
6. Use `APPLY_HEADED=1` when a visible browser is needed.
7. Do not use SSH or remote execution as part of the normal flow.

## Answer rules

- Prefer explicit overrides first.
- Then use deterministic ATS-safe defaults.
- Leave unresolved or low-confidence fields blank and surface them for review.
- Do not let broad heuristics overwrite an explicit answer.
- Keep work-auth and sponsorship questions distinct.

## When to submit

- Do not use unattended submission as the default path.
- If prep is not ready, return the extracted fields and the answers JSON path instead of guessing.

## Dashboard behavior

- The dashboard is for browsing jobs and updating status, not for launching apply flows.
- Apply review happens in the extracted question set and the answers JSON file.

## Receipts

Capture and preserve:
- apply URL
- extracted custom fields
- reviewed answers JSON
- screenshots
- receipt log result
- error text when submission fails

## Commands

- `node scripts/apply-extract.js <job-id>`
- `node scripts/apply-submit.js <job-id> /tmp/apply-answers-<job-id>.json`
- `node scripts/show-apply-log.js`
