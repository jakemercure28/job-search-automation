# Queue Quality TODOs

## Immediate
- Add an explicit queue-quality pass before auto-apply runs.
- Detect and close jobs whose apply pages are gone, redirected to listing pages, or missing a real form.
- Keep queue-quality closures separate from archive actions so closed jobs remain reviewable.
- Add a dashboard reason bucket for `closed-page`, `manual-review-needed`, and `provider-throttled`.
- Keep Ashby blocked by default until spam behavior is solved.
- Default queue order to the lowest eligible pending job first until the submit path is reliable.

## Data / Workflow
- Store a `queue_quality_status` or equivalent closed reason on jobs, not only in attempt receipts.
- Track the last liveness check timestamp and the URL that was actually reached after redirects.
- Prevent retries for any non-`pending` job unless explicitly targeted by job id.
- Add a preflight command that lists “eligible”, “manual review”, and “closed/stale” buckets before submit.
- Keep `manual-review-needed` jobs in `pending`, but make them ineligible for unattended retries.
- Close stale jobs instead of archiving them, unless they are explicitly replaced by a newly discovered listing that should inherit the context.
- If prep is unavailable, do not submit. There is no fallback submit path.

## Detection Improvements
- Detect Greenhouse boards that still load but are not the actual application page.
- Detect Built In and aggregator rows that no longer lead to supported ATS forms.
- Distinguish “closed page” from “temporary network/browser failure”.
- Prefer a lightweight liveness check before launching a full submission browser.

## Dashboard
- Show a dedicated queue-quality panel on the `Auto Applies` page.
- Add one-click filters for `closed page`, `manual review`, and `provider throttled`.
- Link queue-quality failures to the latest receipt and screenshot when available.

## Later
- Auto-close obviously stale jobs during daily maintenance, not only during submit attempts.
- Add a review queue for “manual review required” jobs so Codex or Claude can generate answers deliberately before a submit step.
- Define a shared CLI contract for Codex and Claude Code runs so both tools operate on the same receipt and prep model.
