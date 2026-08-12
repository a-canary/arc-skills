# PONYTAIL-DEBT — arc-skills

Generated 2026-08-12 by `/ponytail-debt` hygiene pass (task 000237).

10 markers, 0 with no trigger.

## bin/prune-merged-branches.sh

- `bin/prune-merged-branches.sh:2` — weekly merged-branch GC across autonomy repos; `branch -d` only (never `-D`), worktree prune first.
  ceiling: no destructive cleanup; relies on operator to verify `-d` suffices.
  upgrade: a branch with unmerged commits survives — switch to a per-repo allowlist + `git merge-base --is-ancestor`.

## bin/selfimprove-monitor.sh

- `bin/selfimprove-monitor.sh:6` — "each adaptor made ≤1 change" check dropped; adaptors write prose.
  ceiling: no per-adaptor diff cap.
  upgrade: a single adaptor rewrites the whole pipeline — re-introduce a `git diff --stat` guard before merge.

## skills/api-providers/refresh.ts

- `skills/api-providers/refresh.ts:32` — tolerate the common list shapes (`{data:[]}`, `{models:[]}`, bare `[]`); extend when a provider breaks it.
  ceiling: handles 3 list shapes by hand.
  upgrade: a 4th shape arrives — switch to a small schema-coercion table driven by `p.list_path`.

- `skills/api-providers/refresh.ts:74` — 1-token ping against `p.base/chat/completions`; catches list-up-but-quota-down (chutes 402).
  ceiling: one provider-specific discovery moment; relies on the model returning 402 fast.
  upgrade: a provider gates with a slow 200 — add a parallel HEAD against `/models` or short-circuit on first quota signal.

## skills/capacity/arbitrate.ts

- `skills/capacity/arbitrate.ts:19` — fixed `FLOOR = 0.1` headroom; promote to a binding knob when a director needs its own.
  ceiling: single global floor, no per-pool override.
  upgrade: a director flags its own headroom — bind `FLOOR` from `CHOICES.md` / `.arc/config`.

## skills/capacity/estimator.ts

- `skills/capacity/estimator.ts:22` — trailing-max keeps silent plan downgrades from poisoning `capLB` for subsequent callers.
  ceiling: O(n) memory per estimator instance.
  upgrade: long-running capacity daemon — switch to a ring buffer with a documented cap.

## skills/postiz-agent/scripts/gate.sh

- `skills/postiz-agent/scripts/gate.sh:19` — grep two known files, not a walk. Projects declare in `AGENTS.md` or `CHOICES.md`.
  ceiling: hand-maintained file list.
  upgrade: a third file is added and missed — read `AGENTS.md` + `CHOICES.md` paths, fall back to walk if absent.

## skills/postiz-agent/scripts/screen.sh

- `skills/postiz-agent/scripts/screen.sh:44` — high-signal injection-sigil set, not exhaustive; stage 2 catches the paraphrases these miss.
  ceiling: regex-only detection.
  upgrade: paraphrase-based injection bypasses — add an embedding-similarity stage against a known-bad corpus.

## skills/skillopt-lite/skillopt.ts

- `skills/skillopt-lite/skillopt.ts:165` — prompt-level guard only; sandbox-enforce the moment any replay is caught.
  ceiling: relies on the model honoring the instruction, no tool-call gate.
  upgrade: a replay escapes the prompt — wrap `tool_use` calls in a policy layer that validates against the candidate config.

## skills/wargame/scripts/gate.sh

- `skills/wargame/scripts/gate.sh:5` — the ONLY deterministic step in execution; parse the ledger table.
  ceiling: parses the rendered markdown table; one whitespace break in `ledger.ts` formatting silently skips the gate.
  upgrade: expose a `--json` output from `bin/ledger.ts` and parse that — markdown parsing becomes belt-and-suspenders.