<!-- Source of truth for the always-on behavioral rules. The install-behavioral-rules
     skill injects the block between the BEGIN/END markers into each harness's
     user-level config (~/.claude/CLAUDE.md, ~/.pi/pi.md, …). Edit here, re-run the
     installer to re-sync. Situational rules (vast, ke) are skills, not this file. -->

<!-- ARC-BEHAVIORAL-RULES:BEGIN -->
# Behavioral rules (always-on)

Be extremely concise. Sacrifice grammar for concision.

- **Prove before scaling.** Demonstrate value on one concrete case before parallelizing, scheduling, fanning out, or productionizing. Single manual run beats scheduled fleet. Asked to "scale X" — first verify X works and matters; propose a minimal validation if proof is missing.

- **Never re-Read a file already read this session** (full or by range) unless you edited it since (Edit/Write return the new state — no verify re-read) or have concrete reason it changed on disk. During an edit/test/fix loop, edit from the in-context copy; re-inspect only a genuinely new range. Top token-waste pattern: source files re-read 7–19×/session.

- **Never Read a `tool-results/<id>.txt` file.** That IS the tool result, already verbatim in context. To re-find a value, scroll back or `grep -n` the one line. Same for re-opening a `~/.claude/waste/*.json` or `/tmp/*-review-*.json` already loaded this session.

- **Grep before reading a large unseen file** (>~300 lines). Need one symbol → `grep -n` then Read with offset/limit, or read the header only. Reserve full reads for files you need end-to-end. Same for Bash: redirect large output to a file (`… > /tmp/out 2>&1`) and grep/tail it ranged — never pipe hundreds of log lines into context for one number.

- **Self-healing must recency-gate.** A journal/tally entry records when a problem was *observed*, not whether it's still live. Before fixing, confirm the live file still has the shape that caused the issue (`git log` timestamp is a hint; live-file shape is authoritative). Never re-fix what's already fixed.

- **Read facts out of tool output before hypothesizing a fault.** A `git log --since`/`ls -l`/`stat` printing dates outside your query window means nothing newer exists — not clock-drift/timezone/corruption. Inspect the literal characters in front of you first.

- **Diagnostic/self-healing subagents run on Claude opus + haiku only.** Cheap half = `model: haiku`, judgment half = `model: opus`. Never minimax or a `pi -p --provider` alias — the Task loader only honors `opus|sonnet|haiku|inherit` and silently falls back. (Production pi-headless workers DO use provider aliases — diagnostics only.)

- **Subagents return distilled findings only** — the conclusion, `file:line` refs, the answer the parent needs. Never raw file contents or command dumps; the final message lands verbatim in parent context. Aim under ~500 tokens; for a large artifact, write it to a file and return the path + one-line summary.
<!-- ARC-BEHAVIORAL-RULES:END -->
