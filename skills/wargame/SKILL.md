---
name: wargame
description: Turn a plan or repo into a branching runbook that fights the mission on paper move-by-move — every move carries its expected observation, most-likely failure, and countermove, every fork a trigger, every branch an abort condition. Writes to <repo>/.wargame/. Use when the user wants to wargame a project, stress-test execution (not just the plan), pre-simulate contingencies so a cheaper model can execute confidently, or runs it after /grill-me. Not a plan — a plan assumes linearity; a wargame assumes reality fights back.
model: claude-fable-5
effort: xhigh
---

# Wargame

ultrathink

Fight the mission **on paper, move by move** (action → reaction → counteraction)
so any cheaper executor can run it having seen every simulated reality. You are
war-gaming, **not executing** — the output is a runbook, not a build.

## Quick start

```
/wargame                    # wargame this repo — infer missions from open work
/wargame <mission or file>  # wargame a specific mission
```

After `/grill-me`: the grill resolved the decision tree — now wargame each
resolved branch into contingencies.

## Workflow

1. **Scope missions.** One mission = one meaty end-to-end objective (a feature,
   a migration, a setup, a fix). From the repo, `/grill-me` output, or the
   user's laundry list. If >1, draft **all** wargames before polishing any.
2. **Name the executor** (optional). If told which model will execute (e.g.
   Sonnet 5), tailor moves to its known behaviour — spawn a `claude-code-guide`
   agent to read that model's docs/system card first.
3. **Recon each mission.** Read the relevant code/config. Surface known-knowns,
   known-unknowns, and — the whole point — the **unknown unknowns** and tacit
   knowledge the executor won't have.
4. **Fight it move by move.** For each move, fill the block in
   [move-block.md](reference/move-block.md): expected observation (worked /
   didn't), most-likely failure + cause + signals, countermove, forks with
   triggers, and 2nd/3rd/4th-order consequences to a chosen depth.
5. **Set depth per branch.** *You* decide how far to simulate each fork — two or
   three scenarios deep where risk is real, one where it isn't. Note where you
   stopped and why.
6. **End with abort conditions.** What error or missing access is a hard blocker
   that should stop execution rather than be worked around.
7. **Log blockers & assumptions.** Any undefined input becomes a `(variable)`
   placeholder in `ledger.md`; every unverified assumption goes in
   `assumptions.md`. Never silently guess — flag it.
8. **Loop to polish.** Re-review each draft against `success.md`, deepen thin
   branches, resolve or escalate placeholders.

## Output tree

Write to `<repo>/.wargame/`:

```
.wargame/
├── main.md            # index: missions, status, links, executor, global abort conditions
├── success.md         # what counts as a complete wargame (the gate)
├── ledger.md          # blockers + (variable) placeholders needing human input
├── assumptions.md     # unverified assumptions, recon that couldn't resolve
├── tasks/             # one mission-brief file per mission (the input objective)
│   └── <mission>.md
└── wargames/          # one wargame per mission (the branching runbook)
    └── <mission>.md
```

Create files lazily — only when you have something to write. `main.md` always
exists as the index. See [templates.md](reference/templates.md) for
`main.md`, `success.md`, `ledger.md`, and mission-brief scaffolds.

## Executing the runbook

`/wargame` writes the runbook; it does not run it. To execute, hand the mission
to a cheaper model — either manually
(`cat .wargame/tasks/X.md .wargame/wargames/X.md | claude -p "…"`) or via the
companion **`/execute-wargame`** skill, which enforces the ledger gate, follows
fork triggers, and halts on abort conditions. See [EXECUTE.md](EXECUTE.md).

## Rules

Wargame, don't build — stop if you catch yourself editing product code. The
Workflow above is the contract: every move carries its failure branch, every
fork a trigger, every unknown a ledger `(variable)` or `assumptions.md` entry,
and all missions get drafted before any is polished.
