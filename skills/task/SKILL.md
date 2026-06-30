---
name: task
description: Isolated thin-vertical-slice execution unit. Creates an isolated workspace (worktree by default), defines a TDD contract, runs implementation, gates on independent adversarial review, and merges or drafts a PR only on clear. Use when the director (or a developer) has identified a gap and needs it executed in isolation with a verifiable outcome. Do NOT use for exploration or research — use /prototype or /diagnose instead.
---

# task

Isolated, verifiable work unit. One slice, one workspace, one TDD contract, one adversarial reviewer. Merges (or drafts PR) only when the review clears.

## Invocation

```
/task "<gap description>" [--slice path/to/slice] [--acceptance "criteria"]
```

Gap description is a plain-language statement from the director. `/task` owns everything from here to the `on-task-verified` binding action.

## Workspace binding

Workspace type is declared in `AGENTS.md`:

```md
workspace: worktree     # git worktree (default)
workspace: treehouse    # treehouse isolation
workspace: <skill>      # custom skill provides workspace
```

`on-task-verified` declares what happens after adversarial review clears:

```md
on-task-verified: merge      # merge to head immediately
on-task-verified: draft-pr   # open a draft PR for human review
on-task-verified: <skill>    # custom action
```

## Execution sequence

1. **Parse gap** — extract slice path and acceptance criteria from description
2. **Create workspace** — via workspace binding; never touches main checkout
3. **Write spec** — `.arc/director/specs/<slice>.md`: goal, acceptance criteria, edge cases, out-of-scope
4. **TDD loop** — write failing tests first, implement until green, no skipped tests
5. **Adversarial review** — independent agent reads spec + diff; actively tries to find logic errors, missing edge cases, spec violations, security issues; produces a verdict
6. **Act on verdict** — clear → `on-task-verified` binding action; blocked → fix and re-review; rejected → emit `task.failed`
7. **Emit result** — write `task.completed` or `task.failed` to event bus with evidence

## Evidence requirement

`task.completed` must include existing file paths:

```jsonl
{"type":"task.completed","ref":"evt_01","worker_id":"tdd-agent","slice":"auth/login","evidence":[{"path":"tests/auth.test.ts","description":"12/12 green, all edge cases in spec covered"},{"path":"src/auth/login.ts","description":"implementation matches spec contract"}]}
```

Director rejects `task.completed` without valid, existing evidence paths.

## Adversarial review verdicts

| Verdict | Meaning | Action |
|---|---|---|
| `clear` | No blocking issues | Execute `on-task-verified` binding |
| `blocked` | Issues found, fixable | Fix in same workspace, re-review |
| `rejected` | Fundamental spec problem or unresolvable | Emit `task.failed`, surface to director |

## What task does NOT own

- Which agent does the implementation (declared in `AGENTS.md`)
- QA / user-facing verification (owned by `/qa`)
- Mission-level gap analysis (owned by `/director`)
- Ledger tracking (owned by `arc-agents` if installed)
- Token budget enforcement (owned by `/director`)
