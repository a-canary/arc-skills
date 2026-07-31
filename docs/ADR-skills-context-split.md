# ADR: Split AGENTS.md — always-on rules vs situational skill-bound rules

**Date:** 2026-07-15  
**Status:** Approved, todo list created  
**Drivers:** 12.5KB dead context loaded every session (~90% of AGENTS.md never fires for the current task)

## Decision

Split `/home/aaron/.pi/pi.md` (symlink → `arc-skills/AGENTS.md`) into:

1. **~2KB always-on rules** — universal principles that fire every turn, any task
2. **Situational rules moved to skills** — each skill's SKILL.md gets a one-liner referencing the rule it owns

And record skill management design decisions here in `docs/ADR-*.md` rather than loading an extra context file.

## Rationale

- Every session loads 14.5KB of AGENTS.md regardless of task
- Most rules (~40) fire in <5% of sessions — paper-prototype, Docker, wargame, hard-merge, etc.
- Skills already load conditionally via `/skill:name` — binding a rule to its skill means it loads only when that skill is invoked
- No new mechanism needed: skills just need a note in their SKILL.md

## Todo list

### Phase 1: Condense AGENTS.md to always-on only

- [x] Audit all lines in AGENTS.md → classify always-on vs situational
- [ ] Write condensed AGENTS.md (~2KB, universal rules only)
  - [x] Lines identified in audit
  - [ ] Create new file content preserving "Before acting read USER.md"
  - [ ] Keep file-boundary tier definitions (concise)
  - [ ] Keep: markdown one-concept-per-line
  - [ ] Keep: never re-Read same file this session (incl pager dumps, tool-results)
  - [ ] Keep: grep before reading large files
  - [ ] Keep: don't load what you won't cite
  - [ ] Keep: measure before change (TDD baseline + delta)
  - [ ] Keep: read tool output literally before hypothesizing fault
  - [ ] Keep: subagents return distilled findings only
  - [ ] Keep: never print secret value into tool output
  - [ ] Keep: never bake operator identity into shared artifacts
  - [ ] Keep: install only first-party + self-authored
  - [ ] Keep: configs/rules in git repo, symlinked into place
  - [ ] Keep: subagent reports UNTRUSTED — verify, git-clean
  - [ ] Keep: /counsel over asking
  - [ ] Keep: commit with identity from USER.md
  - [ ] Keep: never present fabricated data (UM-0500)
  - [ ] Keep: engineer for zero agent trust (condensed)
  - [ ] Remove: prove before scaling → keep in always-on (it's universal)
  - [ ] Remove: MVP/hygiene/phase markers → ponytail skill covers
  - [ ] Remove: self-healing recency-gate → dream, gap-remediate skills
  - [ ] Remove: diagnostics opus+haiku only → dream skill
  - [x] Remove: all dev in worktrees → task skill
  - [x] Remove: no LiteLLM → api-providers skill
  - [ ] Remove: no rate without power → champion-challenger, code-review skills
  - [ ] Remove: red gate → hard-merge skill
  - [ ] Remove: merge own PRs green → hard-merge skill
  - [ ] Remove: UI copy rules → craft-defaults skill
  - [ ] Remove: Gebrauchswert → craft-defaults skill
  - [ ] Remove: self-judge ≠ quality → champion-challenger skill
  - [ ] Remove: paper-prototype before impl → paper-prototype skill
  - [ ] Remove: undefined mission → /define-mission → define-mission skill
  - [ ] Remove: Docker discipline → new docker skill (or existing vast-* skills)

### Phase 2: Update skill files with moved rules

- [ ] ponytail skill — add ponytail: marker debt-log convention if missing
- [ ] dream skill — add self-healing recency-gate + opus+haiku-only diagnostics
- [x] task skill — add all-dev-in-worktrees rule
- [x] api-providers skill — add no-LiteLLM rule
- [ ] champion-challenger skill — add no-rate-without-power + self-judge≠quality
- [x] hard-merge skill — add red-gate + merge-own-PRs rules (partially: adversarial-review pattern covers red-gate concept; explicit rule text not yet added)
- [ ] craft-defaults skill — add UI copy + Gebrauchswert rules
- [ ] paper-prototype skill — add paper-prototype-before-impl rule
- [x] define-mission skill — already covers undefined-mission
- [ ] gap-remediate skill — add recency-gate rule
- [ ] code-review skill — add no-rate-without-power
- [ ] Create docker skill (~10 lines) or add Docker discipline to existing skill
- [ ] ubütquitous-language skill — check for any crossover
- [x] task skill — add all-dev-in-worktrees rule (this commit)

### Phase 3: Replace AGENTS.md on disk

- [ ] Write new condensed AGENTS.md
- [ ] Verify symlink ~/.pi/pi.md still points to it
- [ ] Test: start a session, verify no broken behaviors
- [ ] Remove moved lines from old file (git rm from arc-skills repo)
- [ ] Commit with message: "condense AGENTS.md to always-on only, move situational rules to skills"
- [ ] Push arc-skills

### Phase 4: Verify

- [ ] Daily catchup session runs without missing rules
- [ ] /skill:dreem/gap-remediate loads its new rules correctly
- [ ] /skill:hard-merge loads red-gate and merge-rules
- [ ] /skill:paper-prototype loads paper-prototype-before-impl
- [ ] /task session loads worktree rule via task skill
- [ ] None of the removed rules were actually needed by a session that doesn't load the corresponding skill

