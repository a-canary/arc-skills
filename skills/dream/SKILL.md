---
name: dream
description: Mine conversation history for Claude's own failure modes, then make one system improvement
allowed-tools: Read, Write, Glob, Task, Bash
---

# Dream

Mine raw JSONL conversation logs for Claude's own mistakes, corrections,
hallucinations, and indirections, then make one concrete system change to
prevent the highest-impact recurring issue.

Two phases, two models. No intermediate file layers — the collector pages
sessions in memory and writes one append-only journal; the adapter reads it and
edits one thing.

```
sessions (~/.claude/projects/*/*.jsonl)
        │  page.py streams 80-message windows (in memory, no YAML on disk)
        ▼
collector (minimax) ── Explore subagents on ambiguous failures
        │  appends mistakes / corrections / hallucinations / indirections
        ▼
~/.claude/dream/journal/YYYY-MM-DD.md   (append-only, one file per day)
        ▼
adapter (opus) ── picks ONE highest-impact issue (task-priority order)
        │
        ▼
one edit to an agent | skill | tool | pipeline | script
```

## Phase 1 — Collect (minimax)

1. Today's journal is `~/.claude/dream/journal/$(date +%F).md`. Create the
   `journal/` and `state/` dirs under `~/.claude/dream/` if missing.
2. Find sessions to process (incremental — skips unchanged):
   ```bash
   python3 ~/.claude/skills/dream/scripts/pipeline.py --list --limit 50
   ```
   This prints up to 50 new/changed session JSONL paths (oldest-mtime first),
   checked against `~/.claude/dream/state/processed.json`. The `--limit` caps
   how many sessions one run drains so a cold start (thousands of unprocessed
   sessions) can't spawn thousands of agents in a single tick — the nightly
   cron works the backlog down over successive runs. Omit `--limit` only for a
   deliberate full sweep.
3. For each session, spawn a `collector` agent with the session path and the
   journal path. Run up to 3 in parallel (minimax is cheap, but cli-proxy has
   limited concurrency). The collector pages the session with `scripts/page.py`,
   digs into ambiguous failures with `Explore`, and appends findings.
4. After a session is collected, mark it processed:
   ```bash
   python3 ~/.claude/skills/dream/scripts/pipeline.py --done <session.jsonl>
   ```

## Phase 2 — Adapt (opus)

Once collection is done, spawn one `adapter` agent with today's journal path. It
groups journal entries by root cause, picks the single highest-impact group
(task-priority order UX > quality > security > scale > efficiency; then
frequency × cost × reversibility), and makes exactly one edit to an agent /
skill / tool / pipeline / script. It appends an `## adaptation` block recording
what changed.

## Present results

Summarize: sessions processed, entry counts by type (mistake / correction /
hallucination / indirection), and the one adaptation the adapter made (surface,
file, rationale) — plus any runners-up it noted for the next run.

## Setup

The two phases run as custom subagents (`collector`, `adapter`) on a fast and a
smart model. They need a one-time install — see [SETUP.md](SETUP.md).

## Companion skills

- `/dream-status` — processing state and today's journal entry counts.
- `/dream-insights` — latest journal + adaptation without re-running.

## Incremental processing

`pipeline.py` tracks processed sessions in `~/.claude/dream/state/processed.json`
by source mtime. A session is reprocessed only when its JSONL changes. The
journal is keyed by day, so a session touched across two days contributes to
both days' journals.

## Output layout

```
~/.claude/dream/
├── journal/
│   └── YYYY-MM-DD.md        # append-only: entries + the day's adaptation
└── state/
    └── processed.json       # incremental mtime tracking
```
