#!/bin/sh
# ponytail: weekly merged-branch GC across autonomy repos; branch -d only (never -D), worktree prune first
for r in "$HOME/repos/arc-agents" "$HOME/repos/arc-webui" "$HOME/repos/arc-skills"; do
  git -C "$r" worktree prune
  git -C "$r" branch --merged main 2>/dev/null | grep -vE '^\*|^\+| main$| master$' | xargs -r git -C "$r" branch -d
done
