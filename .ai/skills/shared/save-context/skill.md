---
description: Save what was learned this session back to .context/ files. Use at the end of a session, or when asked to "save context", "wrap up", "save what we learned", or "update context".
allowed-tools: Read, Edit, Write, Bash
---

Review the conversation and persist anything worth keeping to `.context/`.

## Step 1: Review

Scan the conversation for anything that falls into these categories:

| If you noticed... | Update... |
|---|---|
| A correction to your approach or a confirmed non-obvious choice | `.context/people/applicant.md` (working style section) |
| A preference about how the applicant works or communicates | `.context/people/applicant.md` |
| Something about career goals, priorities, or strategy | `.context/goals/career.md` |
| Move logistics, dates, housing, or timeline | `.context/goals/move.md` (if applicable) |
| An interview happened or the applicant shared how one went | `.context/reference/interviews.md` |
| A meaningful career decision was made | `.context/decisions/career.md` |
| A new tool, service, or architectural choice was made | `.context/decisions/tooling.md` or `.context/decisions/architecture.md` |
| A professional contact worth remembering | `.context/people/network.md` |
| Something about a specific application (angle, referral, etc.) | `.context/reference/applications.md` |

All `.context/` files are in `.context/` relative to the repo root.

## Step 2: Write updates

For each file that needs updating:
- Read the current file first
- Add or update only what's new — don't duplicate what's already there
- Convert any relative dates to absolute dates (e.g. "next Thursday" → actual date)
- Don't copy things that already live in `profiles/<active>/` source files

If nothing meaningful was learned this session, say so and skip to done.

## Step 3: Commit

If any files were updated:

```bash
git add .context/ && git commit -m "context: session update $(date +%Y-%m-%d)"
```

## Step 4: Report

Tell the user what was saved (one line per file updated) or confirm nothing needed saving.
