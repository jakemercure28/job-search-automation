#!/bin/bash
# If on main/master, create a new claude/session-* branch before any file edit.
BRANCH=$(git branch --show-current 2>/dev/null)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  NEW_BRANCH="claude/session-$(date +%Y%m%d-%H%M%S)"
  git checkout -b "$NEW_BRANCH" 2>/dev/null
  echo "{\"systemMessage\": \"Auto-branched to $NEW_BRANCH — changes will land here.\"}"
fi
exit 0
