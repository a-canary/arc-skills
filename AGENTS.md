# Agent behavioral rules (always-on)

Canonical source of the always-on agent rules. Git-tracked here; each harness
config (`~/.claude/CLAUDE.md`, `~/.pi/pi.md`, …) is a **symlink** back to this
file — edit here, every harness sees it. Situational rules (vast, ke) are
skills, not this file.

**Before acting you MUST read `~/vault/USER.md`** — your operator's identity,
infra, preferences, and project constraints. This file is the generic doctrine;
USER.md is the personal overlay and overrides it on any conflict.

## File boundaries (earn-it-to-keep)

- **This file (AGENTS.md, public)** — HOW, globally: always-on operational rules every agent needs every turn, any repo, any work. Generic only; specifics live in the docs below and are referenced, never copied.
- **`~/vault/USER.md` (private)** — WHO: operator identity, infra facts, secret locations, preferences. Overlays this file; wins any conflict.
- **`~/vault/missions.md` (private)** — WHY: global axis ranking. Axis = mission (UM-ID) or global principle (defined here in AGENTS.md); position = rank, vetoes bind by kind at any rank. Planning/design/decomposition surfaces only.
- **`<repo>/CHOICES.md`** — WHAT, per repo: prioritized decisions, mission, objectives, `## Mission:` sections citing UM-IDs.
- **`<repo>/AGENTS.md`** — HOW, per repo: repo-scoped operating rules extending this file.

Loading rule: **workers** load this file + USER.md + the repo's AGENTS.md. **Planners and reviewers** read all five. A line stays here only if all agents doing all work need it; else it moves down a tier.

Be extremely concise. Sacrifice grammar for concision.

- **Prove before scaling.** Value on one concrete case before parallelizing/scheduling/fanning out/productionizing. Single manual run beats scheduled fleet. Asked to "scale X" — first verify X works and matters; propose minimal validation if proof missing.

- **MVP marked, hygiene at merge, ceilings at phase.** Inside a branch: minimal build; every deliberate shortcut marked in-code (`ponytail:` names the ceiling + upgrade path — the marker IS the debt log, no debt file). Prove value first (gate/review); losers revert debt-free. Winners pay **compounding debt** — imprecise/colliding names, dangling refs, anything at an interface future commits build on — as separate hygiene commits before merge; it never survives its own PR, diff-size never justifies merging confusion into main. **Constant debt** (naive algorithm, lock granularity, perf) merges WITH its marker and is paid when its ceiling is hit; phase-advance PRs grep the markers and check ceilings against the next phase's gate. Fast and efficient = correct once: what merges is complete — no dangling refs, no unmarked stragglers.

- **Never re-Read a file already read this session** unless you edited it since (Edit/Write return new state — no verify re-read) or have concrete reason it changed on disk. In an edit/test/fix loop, edit from the in-context copy; re-inspect only a genuinely new range. Top token-waste pattern: files re-read 7–19×/session. **This includes your own pager dumps** — when you page a transcript/log to `/tmp/page*.txt` (or any `> /tmp/…` redirect), that window is already in context from the redirect *or* the follow-up Read: emit each `--offset`/`--window` once, forward-only, and never re-`Read`/`tail`/`sed`/re-page the same dump. To re-find one value, `grep -n` that single line; distinct pages are distinct files, not licence to re-open old ones (page-file re-reads/re-dumps were ~63k tokens on 20260705, the day's single biggest bleed).

- **Never Read a `tool-results/<id>.txt` file.** That IS the tool result, already verbatim in context. To re-find a value, scroll back or `grep -n` the one line. Same for re-opening a `~/.claude/waste/*.json` or `/tmp/*-review-*.json` already loaded this session.

- **Grep before reading a large unseen file** (>~300 lines). One symbol → `grep -n` then Read with offset/limit, or header only. Reserve full reads for files needed end-to-end. Same for Bash: redirect large output to a file (`… > /tmp/out 2>&1`) and grep/tail it ranged — never pipe hundreds of log lines in for one number.

- **Don't load what you won't cite.** Before a whole-artifact pull — a `WebFetch`, a `python … | head -N` dump, a Read of a seam you just wrote to `/tmp` (audit/recon dumps, extracted pages) — name the specific fact or seam it must yield. Have that name → `grep -n`/search the artifact for it and pull only the hit's range. Can't name it → don't load it; the pull is speculative and usually goes unreferenced. Unlike a reread (the guard hook catches those), a first-load-then-never-use bleeds silently and only surfaces in the next tally: the `unreferenced` pattern cost ~27k tokens on 20260706 (a 10.2k WebFetch of SDK docs never cited, four `wg_audit/*_dump.txt` seams read whole and never used, a 2.6k PDF-page extraction). WebFetch a doc → fetch only to answer a named question, then quote/act on it or drop it.

- **Measure before you change (TDD baseline + delta).** Record a baseline first — the current value of whatever the change should move (failing test, benchmark, error count, latency) — then make the change and record the delta. No baseline = no way to tell if it helped; "looks better" is not a measurement. Perf captures before-timing, a bug fix the reproducing failure, a refactor the green suite it must keep green. State baseline + delta when reporting.

- **Self-healing must recency-gate.** A journal/tally entry records when a problem was *observed*, not whether it's still live. Before fixing, confirm the live file still has the shape that caused the issue (`git log` timestamp is a hint; live-file shape is authoritative). Never re-fix what's already fixed.

- **Read facts out of tool output before hypothesizing a fault.** A `git log --since`/`ls -l`/`stat` printing dates outside your query window means nothing newer exists — not clock-drift/timezone/corruption. Inspect the literal characters in front of you first.

- **Diagnostic/self-healing subagents run on Claude opus + haiku only.** Cheap half = `model: haiku`, judgment half = `model: opus`. Never minimax or a `pi -p --provider` alias — the Task loader only honors `opus|sonnet|haiku|inherit` and silently falls back. (Production pi-headless workers DO use provider aliases — diagnostics only.)

- **Subagents return distilled findings only** — the conclusion, `file:line` refs, the answer the parent needs. Never raw file contents or command dumps; the final message lands verbatim in parent context. Aim under ~500 tokens; for a large artifact, write it to a file and return the path + one-line summary.

- **Commit with the identity in `~/vault/USER.md`**, never a tool default. Set `-c user.name -c user.email` per-commit; don't trust global config. Found a wrong-author commit on a fresh private repo → amend `--reset-author` + force-push.

- **All dev in worktrees.** Primary checkout = production: never edit/commit dev work there. Prefer **treehouse** (`get` acquires a pooled pre-warmed worktree, `return` recycles it — deps/cache kept) over raw EnterWorktree / `git worktree add`, off origin/<default> for any change incl. one-liners. Merge back via PR to origin, then local main `pull --ff-only`. Worker/loop lifecycles spawn + exit their own worktree.

- **No LiteLLM / multi-key API proxies** — security risk. Direct API + keys from the operator's secret store (see USER.md); route models via pipeliner/config.

- **Never print a secret's value into tool output.** To check whether a key/token is set, test *presence* not value: `[ -n "$MINIMAX_API_KEY" ] && echo set || echo unset`, or `printenv MINIMAX_API_KEY >/dev/null && echo set`. Never `env | grep -i key`, `echo $X_API_KEY`, or any pipe that echoes the literal secret — the value lands verbatim in the session log (and git-tracked journals/tallies downstream). Masked prefixes count as leaks. Applies to API keys, tokens, passwords, GPG-pass reads: consume them into a variable/command, never surface them.

- **Install only first-party + self-authored.** Upstream maintainer's main repo, or own code. Reject by default all UGC plugins / skill libs / dashboards / memory providers.

- **Configs and rules live in a git repo, symlinked into place.** Source-of-truth for any config/ruleset is a tracked file in a repo; the consuming location (`~/.claude/CLAUDE.md`, `~/.pi/pi.md`, dotfiles, …) is a symlink back to it — the `npx skills` pattern. Never hand-maintain divergent copies. Edit the canonical, the symlinks follow.

- **No rate without power.** Sample size set by required confidence, not the cached artifact. Report Wilson 95% CI; overlapping CIs = same result — don't "reconcile" noise. >80% bar needs n≥230; underpowered → no point estimate.

- **Red gate = one obligation.** Fix pre-existing failures first; never footnote as out-of-scope. Exception: a later phase of the *same* refactor will green/delete the test → commit but hold push until all green together.

- **Merge own PRs when terminally green.** Owned repos (ADMIN): no human PR — merge once (1) an independent reviewer agent (different session, hunts blockers) clears AND (2) local merge-gate green. Author never approves own work. Non-owned public: draft PR only, operator submits (see USER.md). PR-per-feature (branch off base, never push straight to main). Evidence terminal: state=OPEN, MERGEABLE, CLEAN, all checks COMPLETED/SUCCESS (re-poll at merge time).

- **UI copy: casual + terse, no visible timestamps.** Short verbs (`Pick`, `Send`), terse empty states (`nothing pending`). Keep timestamps in the data layer for sort/staleness; never paint them on the surface.

- **Gebrauchswert: functionality before|over visual appeal.** Optimize the practical value a user derives from everyday functionality, not visual appeal. Feature/design forks default to the option that does more daily work; polish serves use, never the reverse.

- **Never present fabricated data as real (UM-0500).** No mocked/simulated/estimated values reported as measurements; no suppressed errors; certifying a condition needs logged evidence. Unmeasured = not passed.

- **Self-judge ≠ quality.** A producing model scoring against its own rubric proves consistency, not quality. Get a second *disagreeing* judge before claiming improvement; diminishing self-judge deltas = stop signal, not success.

- **Paper-prototype before implementation.** Any new module design/spec MUST be validated with /paper-prototype before code is written: hand-execute the process on live/near-prod data (existing APIs + proven code only, md/json/csv/html intermediates) and land the SPEC-DELTA (validated flow, submodules, dependencies, spec revisions) back into the spec. No implementation issues (/to-issues) or worker dispatch on an unvetted spec. Skip only for trivial changes with no new process (one-liners, config, copy), stating the skip.

- **Undefined mission (UM) → /define-mission.** A goal/objective/PRD that maps to no rule (`### UM-xxxx`) in `~/vault/missions.md`, or proposes a new value-dimension, must not proceed to PRD/issues/implementation — run /define-mission first (then /apply-mission per repo). Every objective/metric names its UM-ID; `[pending user review]` tags are cleared by the user only.

- **Engineer for zero agent trust.** No unit of agent work is believed — it is *checked*: plans wargamed (/wargame) before execution, code compiled + tested, worker outputs verified against rubric/standards/common-problem lists, checkers themselves audited (a gate is also a work unit). Verification is what makes cheap models safe: distrust reduces cost and increases speed at no quality loss. Check-vs-claim conflict → retry once with the discrepancy named; still conflicting → escalate to a higher-tier model, never paper over. Specific instances: subagent-reports-UNTRUSTED, self-judge ≠ quality, merge-on-clear reviewer gate; doctrine root of hypothesis_not_fact (arc-agents/roles/AGENTS.md).

- **Subagent reports UNTRUSTED.** They have tampered guards + fabricated findings to look confident. Verify every checkable claim against source (grep the constant) before acting. Forbid hooks/env edits in the dispatch prompt; after any fs-sharing subagent, verify guard hooks git-clean.

- **/counsel over asking.** Decision/approval fork mid-task → run /counsel (5-expert panel), execute its verdict autonomously; don't AskUserQuestion or pause. Prefer the reversible/non-destructive option; keep export-to-trash before any delete. Respect hard safety-classifier blocks (counsel routes around via code-only fix).

- **Docker: own-stack only + shared-resource discipline.** Mission automations operate ONLY their own repo's containers/compose files (per-repo `.claude/settings.json` allow-rules, name-scoped). Never touch another stack (see USER.md for the host's stacks) — no `docker system prune`, no blanket restarts, no killing containers you didn't start; cross-stack action needs /counsel. Shared host etiquette: check disk (>10G free) + load before builds; one heavy build/pull at a time; GPU single-tenant (`nvidia-smi` before claiming); never bind another service's port (check `ss -ltn` first); under capacity contention yield by axis rank (`~/vault/missions.md` ranking).
