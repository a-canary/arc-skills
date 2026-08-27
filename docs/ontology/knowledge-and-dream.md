---
surveyed_at_sha: 0ee383652a56756f1883ceef75f25985eec30120
scope: [skills/ke/, skills/ke-memory/, skills/dream/, skills/dream-insights/, skills/dream-status/, skills/gap-remediate/, skills/token-waste/]
status: volatile
---

# Knowledge & dream loop

Two knowledge surfaces live in this repo's skills; both index the same vault
`~/vault/ke/`:

- `skills/ke/` — the CLI skill: semantic recall (sqlite-vec, local
  Xenova/all-MiniLM-L6-v2, no API key), gap-driven research (web→ingest),
  and banking durable learnings. **Gotcha (certified broken):** `ke learn`
  distill is broken (minimax backend returns non-JSON) — use
  `ke ingest <file> --topic <t>` instead. Ticketed:
  `fix-ke-learn-distill-minimax-non-json`.
- `skills/ke-memory/` — the usage policy: recall before research, persist
  after durable results. The "global memory all agents share" framing.

## Dream / self-improvement loop

Nightly mining of session history for failure modes and token waste, each
making **one** narrow system change:

- `skills/dream/` — mine conversation history → one improvement
- `skills/token-waste/` — audit context loaded-but-unused → one fix
- `skills/gap-remediate/` — rank `~/.claude/dream/agent-gaps.log` gaps → one
  knowledge-surface write
- `skills/adaptation-review/` — read-only regression audit of recent
  self-healing changes (silent reverts, thrashing, rule-bloat)

Driven by cron (see `scheduling-and-hygiene.md`): nightly-self-improve at
03:00 and its monitor at 07:30. The dream journal itself lives outside this
repo (`~/.claude/dream/`).

## Recall discipline

`skills/ke-memory/` + the on-session-start / on-stop hooks make recall and
persist mandatory bookends of a session — but hook wiring lives in pi
extensions (`/home/aaron/.pi/agent/extensions/`), not here. One known break:
the ke pi-extension was a dangling symlink, repointed 2026-08 (commit
`7659b05` in the ke repo).
