#!/usr/bin/env bash
# smoketest: dream — conversation self-improvement skill (arc-skills layout).
#
# Usage:
#   tests/smoketest.sh [skill_dir]
# If [skill_dir] is omitted, defaults to the dream skill dir (parent of tests/).
set -euo pipefail
DREAM="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SKILLS="$(cd "$DREAM/.." && pwd)"
bad=()

# Main skill + its install doc
for f in SKILL.md SETUP.md SOURCE.md; do
  [[ -f "$DREAM/$f" ]] || bad+=("missing: dream/$f")
done
# Sibling companion skills
for skill in dream-status dream-insights; do
  [[ -f "$SKILLS/$skill/SKILL.md" ]] || bad+=("missing skill: $skill")
done
# Two agents expected: collector (fast) + adapter (smart)
for agent in collector adapter; do
  [[ -f "$DREAM/agents/$agent.md" ]] || bad+=("missing agent: $agent")
done
# Core scripts present
for f in scripts/page.py scripts/pipeline.py scripts/extract.py; do
  [[ -f "$DREAM/$f" ]] || bad+=("missing script: $f")
done
# No stale plugin-root path refs survived in functional files (SKILL, agents,
# scripts). SOURCE.md and this smoketest legitimately mention the old token.
if grep -rql 'CLAUDE_PLUGIN_ROOT' \
     "$DREAM/SKILL.md" "$DREAM/agents" "$DREAM/scripts" 2>/dev/null; then
  bad+=("CLAUDE_PLUGIN_ROOT ref still present in a functional file")
fi

if [[ ${#bad[@]} -gt 0 ]]; then
  printf '%s\n' "${bad[@]}" >&2
  exit 1
fi
