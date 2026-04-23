---
name: apply
description: Reviewed local workflow for direct job-application requests. Use when asked to apply to a specific job or submit an application. Extract custom questions, draft answers, require explicit approval before submit, preserve screenshots and receipt logs, and keep execution on the local MacBook checkout.
---

# Apply

Use this skill as the primary entry point for direct apply and submit requests in this repo.

## Workflow

1. Read `.env` and resolve the active profile from `JOB_PROFILE_DIR` and `JOB_DB_PATH`.
2. Load active profile context only when needed:
   - `{JOB_PROFILE_DIR}/context.md`
   - `{JOB_PROFILE_DIR}/career-detail.md`
   - `{JOB_PROFILE_DIR}/resume.md`
3. Resolve the job ID before doing anything destructive. If the user did not supply one, find the target job from the active SQLite DB first.
4. Run `node scripts/apply-extract.js <job-id>` to extract the custom application questions from the live apply page.
5. Draft answers for the extracted fields in the applicant's voice. Save the final reviewed answers as a JSON object at `/tmp/apply-answers-<job-id>.json`, keyed by field name.
6. Review the extracted fields and final answers with the user before any submit step.
7. Submit only after explicit approval from the user with `node scripts/apply-submit.js <job-id> /tmp/apply-answers-<job-id>.json`.
8. Use `APPLY_HEADED=1` when a visible browser is needed for review or debugging.
9. Keep execution local. Do not use SSH or remote execution as the normal apply path.

## Answer Rules

- Prefer explicit overrides first.
- Then use deterministic ATS-safe defaults.
- Leave ambiguous, unresolved, or low-confidence fields blank and surface them for review.
- Do not let broad heuristics overwrite an explicit answer.
- Keep work authorization and sponsorship questions distinct.

## When To Stop

- Do not submit unattended by default.
- If extraction fails or the apply page is unsupported, stop and show the page issue instead of guessing.
- If prep is not ready, return the unresolved fields and the answers JSON path instead of guessing.
- If a question is ambiguous or unsupported, stop at review and ask for approval or missing inputs.

## Receipts

Capture and preserve:

- apply URL
- extracted custom fields
- reviewed answers JSON
- screenshots
- submit result
- receipt log entry or error text when submission fails

## Commands

- `node scripts/apply-extract.js <job-id>`
- `node scripts/apply-submit.js <job-id> /tmp/apply-answers-<job-id>.json`
- `node scripts/show-apply-log.js`
