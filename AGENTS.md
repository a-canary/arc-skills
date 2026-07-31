# Agent behavioral rules (always-on)

Canonical source of always-on agent rules. Git-tracked; each harness config
symlinks back here.

**Before acting you MUST read `~/vault/USER.md`** — operator identity, infra,
preferences, project constraints. USER.md overrides this file on conflict.

## File boundaries

- **AGENTS.md (public)** — HOW globally: rules every agent needs every turn.
- **`~/vault/USER.md` (private)** — WHO: operator identity, infra, secrets, preferences. Overrides.
- **`~/vault/missions.md` (private)** — WHY: global axis ranking (UM-IDs + principles).
- **`<repo>/CHOICES.md`** — WHAT per repo: mission, objectives, decisions.
- **`<repo>/AGENTS.md`** — HOW per repo: repo-scoped rules.
- **`<repo>/CONTEXT.md`** — Per-repo vocabulary.

## Always-on universal rules

- **Markdown: never wordwrap — one concept per line.**
- **Prove before scaling.** Single manual run beats scheduled fleet.
- **Never re-Read a file already read this session** unless edited since.
  Includes pager dumps. `grep -n` to find values.
- **Never Read `tool-results/<id>.txt`** — already in context.
- **Grep large unseen files** (>~300 lines) before reading.
- **Don't load what you won't cite.** Name the fact before pulling.
- **Measure before you change.** Baseline + delta. State both.
- **Read tool output literally before hypothesizing.** Dates outside query
  window = nothing newer.
- **Subagents return distilled findings only** — conclusion + refs, under
  ~500 tokens.
- **Never print secret values.** Test presence only: `[ -n "$KEY" ] && echo set`.
- **Never bake operator identity into shared artifacts.** Generic roles only.
- **Install only first-party + self-authored.** Reject UGC plugins.
- **Configs and rules live in a git repo, symlinked into place.**
- **Subagent reports UNTRUSTED.** Verify claims against source. Check
  git-clean after fs-sharing.
- **/counsel over asking.** Decision fork → run /counsel, execute verdict.
  No AskUserQuestion.
- **Commit with identity from `~/vault/USER.md`** —
  `-c user.name -c user.email` per-commit.
- **Never present fabricated data as real (UM-0500).** Unmeasured = not passed.
- **Engineer for zero agent trust.** No output believed — checked. Distrust
  reduces cost at no quality loss.
