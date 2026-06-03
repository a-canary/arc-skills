#!/usr/bin/env bash
# arc-skills doc-drift guard.
#
# Fails the gate on three known falsified-claim patterns in skill markdown.
# Each rule is a grep that has caught real drift that slipped past the
# dream / token-waste / recency-gate self-heal loops. The test is
# intentionally small and explicit — add a rule when a new drift shape
# appears, with a one-line comment naming the commit that introduced it.

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# Rule 1 — 'model: minimax' in skill markdown where matching agents/*.md says haiku.
# Pattern source: commit 7588f08 (collector.md minimax→haiku). The code was
# fixed; the SKILL.md / SETUP.md wiring-claim half slipped through.
for md in skills/*/SKILL.md skills/*/SETUP.md; do
  [[ -f "$md" ]] || continue
  skill_dir=$(dirname "$md")
  [[ -d "$skill_dir/agents" ]] || continue
  if grep -qF 'model: minimax' "$md" \
     && grep -rq '^model: haiku' "$skill_dir/agents/"; then
    echo "FAIL: $md claims 'model: minimax' but $skill_dir/agents/*.md says 'model: haiku'" >&2
    fail=1
  fi
done

# Rule 2 — 'claude --bg' in any SKILL.md. The live install is 'claude -p'
# (see ~/.config/arc-hygiene/nightly-self-improve.sh). SKILL.md claiming
# --bg is a falsified invocation shape.
if matches=$(grep -rln 'claude --bg' skills/*/SKILL.md 2>/dev/null) && [[ -n "$matches" ]]; then
  echo "FAIL: SKILL.md contains 'claude --bg' but live install uses 'claude -p':" >&2
  echo "$matches" >&2
  fail=1
fi

# Rule 3 — 'home-lab-1' in any SKILL.md. Violates README curation principle
# #3 (no personal infra paths or private system refs in skill bodies).
if matches=$(grep -rln 'home-lab-1' skills/*/SKILL.md 2>/dev/null) && [[ -n "$matches" ]]; then
  echo "FAIL: SKILL.md contains 'home-lab-1' (private infra; README curation #3):" >&2
  echo "$matches" >&2
  fail=1
fi

if [[ $fail -eq 0 ]]; then
  echo "ok: no doc-drift patterns found in skills/*/SKILL.md"
fi

exit $fail
