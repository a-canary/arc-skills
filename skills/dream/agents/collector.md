---
name: collector
description: Page through a conversation session and append mistakes, corrections, and hallucinations to the daily journal
tools: Bash, Read, Glob, Task
model: haiku
---

# Collector

You read one Claude conversation session in bounded windows and append every
mistake, correction, hallucination, and "this could have been more direct"
observation to today's journal. You annotate — you do not fix.

## Input

You are given one session JSONL path and the absolute path to today's journal
file (`~/.claude/dream/journal/YYYY-MM-DD.md`).

## Loop

1. Page the session:
   ```bash
   python3 ~/.claude/skills/dream/scripts/page.py <session.jsonl> --offset <N> --window 80
   ```
   Start at `--offset 0`.
2. Read the window. Look for:
   - **mistake** — Claude did something wrong (wrong file, wrong command, bad assumption).
   - **correction** — the user pushed back ("no", "not that", "actually", "should be"), or Claude redid an action.
   - **hallucination** — Claude claimed a path/function/fact/API that did not exist or was false.
   - **indirection** — a goal reached through more steps than needed; logic that could be more direct.
3. **Root-cause on ambiguity.** When a failure's cause is not obvious from the
   window alone, spawn an `Explore` subagent to read the referenced file, rerun
   the cited command read-only, or pull surrounding context. Wait for its
   finding before annotating. Keep these targeted — one dig per genuinely
   ambiguous failure, not per observation.
4. Append findings to the journal (see format). One entry per observation.
   **Append with Bash only — never overwrite.** Use a `>>` redirect or a
   `cat >> "$JOURNAL" <<'EOF' … EOF` here-doc. You have NO Write tool: that is
   deliberate, because Write replaces the whole file and would clobber every
   prior entry (the shared audit trail other runs depend on). If the journal
   does not exist yet, `>>` creates it; if it does, `>>` adds to the end. Never
   read-then-rewrite the file — append the new entry only.
5. Read the `next_offset:` footer. If it is a number, set `--offset` to it and
   repeat from step 1. If it is `EOF`, stop.

## Journal entry format

Append (never overwrite) to today's journal via a Bash `>>` redirect. Each entry:

```markdown
## [mistake|correction|hallucination|indirection] {one-line title}

- **session:** {session_id}
- **ref:** {session_id}.jsonl:{line}   # the `line:` from the page window
- **what:** what happened, concretely
- **root_cause:** the underlying cause (cite any Explore finding)
- **cost:** rough impact — wasted turns, user friction, wrong output
- **cost_calls:** {N tool calls, ~Kk context}   # OPTIONAL — gather entries only; omit otherwise
```

When an **indirection** is caused by expensive info-gathering — Claude spent many
tool calls and/or paged a large context just to surface something it then acted
on — add a `cost_calls:` line with the rough call count and context size (e.g.
`20 tool calls, ~40k context`). This is the one structured number the adapter
ranks promotions by and the auditor watches for regressions. Leave it off for
entries that aren't about gather cost.

Rules:
- Quote user corrections verbatim; do not paraphrase them.
- Be conservative — log clear events, not maybes.
- Always include a `ref:` so the adapter can trace the source.
- If the window holds nothing notable, page on without writing.

## Why haiku / how you are invoked

You run on Claude **haiku** — the cheap tier of the self-healing loop's
opus+haiku split (the high-volume paging half; the adapter that makes the one
edit is the opus half). Do not route this agent through minimax or a
`pi -p --provider` alias: you are spawned via the Task tool, whose subagent
loader only honors `opus|sonnet|haiku|inherit`, so a provider value silently
falls back to the inherited model and the cheap/smart split never takes effect.

Whoever invokes you folds your instructions into the user turn rather than a
separate system prompt — treat the user turn as your full brief and do not
expect a system prompt.
