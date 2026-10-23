#!/usr/bin/env bash
# Copy gitignored files declared in .worktreeinclude from the primary checkout
# into a task worktree. Self-contained (no quay plugin layout dependency).
#
# Usage: bash scripts/worktree-include.sh [--verify] <worktree-path>
# Exit: 0 = every declared file present (and copied, when not --verify); 2 = missing.
set -euo pipefail

mode="copy"
if [ "${1:-}" = "--verify" ]; then mode="verify"; shift; fi
wt="${1:?usage: worktree-include.sh [--verify] <worktree-path>}"
[ -d "$wt" ] || { echo "worktree-include: not a directory: $wt" >&2; exit 2; }

primary="$(git -C "$wt" worktree list --porcelain | sed -n '1s/^worktree //p')"
[ -n "$primary" ] || { echo "worktree-include: cannot resolve primary checkout" >&2; exit 2; }

decl="$wt/.worktreeinclude"
[ -f "$decl" ] || decl="$primary/.worktreeinclude"
[ -f "$decl" ] || exit 0

missing=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue;; esac
  rel="${line#/}"
  if git -C "$primary" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
    continue
  fi
  src="$primary/$rel"
  dst="$wt/$rel"
  if [ "$mode" = "copy" ] && [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -p "$src" "$dst"
  fi
  [ -f "$dst" ] || missing+=("$rel")
done < "$decl"

if [ ${#missing[@]} -gt 0 ]; then
  echo "worktree-include: missing in $wt: ${missing[*]}" >&2
  exit 2
fi
exit 0
