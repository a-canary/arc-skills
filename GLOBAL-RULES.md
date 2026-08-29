# Agent behavioral rules (always-on)

Canonical source of always-on agent rules. Git-tracked. Loaded once per
session via each harness's user-level config symlink (`~/.pi/agent/AGENTS.md`,
`~/.claude/CLAUDE.md`, … → this file; see skills/install-behavioral-rules).
Deliberately NOT named AGENTS.md/CLAUDE.md: any walk-up context file carrying
this content would double-inject it. Repo-level AGENTS.md files are thin
pointers or repo-scoped rules only — never copies of this file.

**Before acting you MUST read `~/vault/user.md`** — operator identity, infra,
preferences, project constraints. `~/vault/USER.md` overrides this file on conflict.

## File boundaries

- **GLOBAL-RULES.md (public, this file)** — HOW globally: rules every agent needs every turn.
  Symlinked as each harness's user-level AGENTS.md/CLAUDE.md; one copy per session.
- **`~/vault/user.md` (private)** — WHO: operator identity, missions, communication style.
- **`~/vault/USER.md` (private)** — WHO override: infra, secrets, preferences. Overrides user.md on conflict.
- **`~/vault/missions.md` (private)** — WHY: global axis ranking (UM-IDs + principles).
- **`<repo>/CHOICES.md`** — WHAT per repo: mission, objectives, decisions.
- **`<repo>/AGENTS.md`** — HOW per repo: repo-scoped rules.
- **`<repo>/CONTEXT.md`** — Per-repo vocabulary.
- **`~/vault/ontology/OVERVIEW.md`** — Agentic harness ontology (meta map:
  harnesses, ledger/factory, LLM routing, knowledge, scheduling, roles).
  Placement policy: project-scoped maps live in the repo; meta maps in vault.
  Read the topic file when touching that subsystem; `findings.md` tracks
  open overlaps/conflicts/gaps (each ticketed in the ledger).

## Context loading

At session start, load these files into the system prompt:
- `~/vault/user.md`
- `~/vault/USER.md` (overrides user.md on conflict)

## Always-on universal rules

- **Markdown: never wordwrap — one concept per line.**
- **Prove before scaling.** Single manual run beats scheduled fleet.
- **Never re-Read a file already read this session** unless edited since.
  Includes pager dumps. `grep -n` to find values.
- **Never Read `tool-results/<id>.txt`** — already in context.
- **Grep large unseen files** (>~300 lines) before reading.
- **Never `Read` a session `.jsonl` transcript into context.** It is a raw
  conversation dump — extract only what you need via `jq`/`grep` piped to a file,
  or read the specific line range. (Was ~56% of 2026-08-26 measured token waste.)
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
- **Write lane (prose rule; structural gate pending — arc-director
  DESIGN.md invariant 7).** Only write files under `~/repos/**`, `/tmp/**`,
  `~/vault/ke/**`, `~/vault/director/**`, and the ledger (via bookie only).
  Any other path — new home dirs, `~/bin`, `~/agents`, other vault subtrees —
  requires captain approval before the first write. Check the target path
  before writing, not after.
- **Docs are earn-or-tmp (operator ruling 2026-08-27).** A persistent .md
  file may only be created if the human explicitly requested it or a skill
  defines it as output; everything else goes to /tmp and is trashed when its
  referencing task completes.
- **File layout: overlays nest, registries don't (operator ruling
  2026-08-27).** Context overlays (AGENTS.md, CONTEXT.md) are
  path-inherited — they apply to their folder + subfolders, nearest wins.
  Identity registries (root CHOICES.md; docs/adr/, docs/ontology/,
  docs/codemap/) are single-per-project, never nested; sub-scope via
  metadata fields inside the artifact. Repos with docs/ content carry a
  Map section in root AGENTS.md. Full rule: arc-skills
  docs/proposals/map-ontology.md §5d B.
- **Operator review goes to arc-webui as HTML (operator ruling
  2026-08-27).** Anything requiring captain review is presented as a
  self-contained HTML page under /review/<file> on arc-webui
  (http://home-lab-1:8080/review/<file>; artifacts in
  ~/vault/director/reviews/), linked from a human-gate ledger row
  (bookie create --kind task --type HITL). Never "open this file path".
