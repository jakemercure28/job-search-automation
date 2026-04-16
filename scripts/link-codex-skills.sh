#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shared_dir="$repo_root/.ai/skills/shared"
codex_root="${CODEX_HOME:-$HOME/.codex}/skills"

mkdir -p "$codex_root"

# Remove stale links that still point into this repo's shared skill dir.
for existing in "$codex_root"/*; do
  [ -L "$existing" ] || continue
  target="$(readlink "$existing")"
  case "$target" in
    "$repo_root/.ai/skills/shared"/*)
      rm -f "$existing"
      ;;
  esac
done

for skill_dir in "$shared_dir"/*; do
  [ -d "$skill_dir" ] || continue
  skill_name="$(basename "$skill_dir")"
  target="$codex_root/$skill_name"

  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf "$target"
  fi

  ln -s "$skill_dir" "$target"
  echo "linked $skill_name"
done
