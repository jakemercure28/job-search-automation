#!/bin/bash
# At session end: push branch and open a PR if none exists yet, or report the existing one.
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

# Always push unpushed commits (even if a PR is already open)
UNPUSHED=$(git log "origin/$BRANCH"..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$UNPUSHED" -gt 0 ]; then
  git push -u origin "$BRANCH" 2>/dev/null
fi

# If a PR already exists, report it
EXISTING=$(gh pr view "$BRANCH" --json number,url --jq '"#\(.number) \(.url)"' 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "{\"systemMessage\": \"PR already open: $EXISTING\"}"
  exit 0
fi

# Open a new PR
PR_URL=$(gh pr create --fill 2>/dev/null)
if [ -n "$PR_URL" ]; then
  echo "{\"systemMessage\": \"PR opened: $PR_URL\"}"
fi
exit 0
