---
description: Commit changes, push to branch, and open a PR. Use at the end of any coding session to ship work.
---

Commit all changes made this session, then let the Stop hook push and open a PR.

## Workflow

1. Run `git status` to see what changed.
2. Stage only the files relevant to this session's work (never `jobs.db`, `.env`, `*.pdf`, `*-cache.json`, or other gitignored artifacts — see CLAUDE.md).
3. Write a commit message in the format `<type>: <brief summary>` (types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`).
4. Commit. The Stop hook will push the branch and open a PR automatically when this response ends.

## Branch behavior

- If the session started on `main`, the `PreToolUse` hook already switched to a `claude/session-YYYYMMDD-HHMMSS` branch. Commit goes there.
- If already on a feature branch, commit goes to the current branch.
- The Stop hook only fires once Claude stops responding, so the PR opens right after this turn completes.

## What to tell the user

After committing, say: "Committed — PR will open automatically when I finish this response."
