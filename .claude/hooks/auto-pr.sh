#!/bin/bash
# At session end: push branch and open a PR if commits exist and no PR is open yet.
BRANCH=$(git branch --show-current 2>/dev/null)

# Nothing to do on main/master or detached HEAD
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] || [ -z "$BRANCH" ]; then
  exit 0
fi

# Nothing to do if no commits ahead of main
AHEAD=$(git log main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$AHEAD" -eq 0 ]; then
  exit 0
fi

# Nothing to do if a PR already exists
if gh pr view "$BRANCH" --json number >/dev/null 2>&1; then
  exit 0
fi

# Push and open PR
git push -u origin "$BRANCH" 2>/dev/null
PR_URL=$(gh pr create --fill 2>/dev/null)
if [ -n "$PR_URL" ]; then
  echo "{\"systemMessage\": \"PR opened: $PR_URL\"}"
fi
exit 0
