# Reviewer prompt contract

An adversarial gate is only as good as the run that performs it. A reviewer that
times out, or answers about a stale revision, or never writes a verdict, has not
gated anything — and a silent empty answer reads exactly like approval.

This file is the launch contract for every Defend* reviewer run, plus the
measured failure ledger it comes from. `bin/defend-ask` enforces it.

## Where this lives

These files (`bin/defend-ask`, `bin/defend-ask-test`, `reviewer-prompt.md`) are
tracked in arc-skills and that is the only authoritative copy.
`~/vault/director/leads/artifacts/reviewer-contract/` is a reading pointer, not
a second source — changes made only there do not change what runs. The default
reviewer model must not be a banned model (no glm-5.x), and
`bin/defend-ask-test` (section 8) enforces that: it derives the default from the
source, checks the ban, checks agreement with the dry-run launch line, and
checks the model exists in the pi catalog.

## The four items (all mandatory)

1. **A forced verdict line.** The final message must start with exactly
   `VERDICT: CLEAR` or `VERDICT: ATTACKS`, then numbered findings. No verdict
   line = failed run, not a pass.
2. **A tool budget with an emit-by point.** `Cap: N tool calls` and "emit the
   verdict by call N whatever you have read". Open-ended "attack this" invites a
   full read of a 6k-line file and produces no answer.
3. **Artifact status stated explicitly.** Is this a *design* (the code does not
   contain it and that is expected) or *merged code*? Without this the reviewer
   spends its budget "proving" an unimplemented feature is unimplemented — the
   premise, not a finding.
4. **Real artifacts named, with revision identity.** Absolute paths that exist
   now, plus the design REV and the artifact's mtime/sha. A reviewer pointed at
   a path it cannot open reviews a memory.

Two additions that pay for themselves:

- **"UNRESOLVED + why beats silence."** A stated gap is a usable finding; a
  timeout is a wasted 25 minutes.
- **Anti-duplication:** "never open a file twice, never read a file whole when
  grep + line range answers it." Breadth-first reading is what fits a budget.

## Launcher

```bash
bin/defend-ask <prompt-file> [--calls N] [--model M] [--thinking LEVEL] [--dry-run]
```

- Checks items 1–3; if any is missing it writes the canonical block to
  `<prompt>.effective` and launches that (the input prompt is never modified).
- Refuses (rc 2) if no absolute path in the prompt exists on this host.
- Refuses (rc 2) if `--model` is not in the live catalog (`pi --list-models`) or
  lacks a `provider/` prefix, printing what that provider actually offers. A bad
  model id is not a cheap mistake: the run returns 404 and gates nothing.
- **Timeout is computed from the budget**: `600 + 90 × calls`, floor 1200 s.
  40 calls → 4200 s; 20 calls → 2400 s.
- **The exit code tells you whether you were gated**: `0` = a `VERDICT:` line was
  produced, `3` = the run finished but wrote no verdict (gated *nothing* — re-run
  narrowed, never read as a pass), `124` = wall clock exhausted, `2` = refused
  before launch. The full transcript is kept at `<prompt>.out` for the ledger.
- Launch it in the background (`bg_run`), never inline. Pass the prompt as a file
  read by the shell: `pi -p "$(cat prompt.txt)"`. An inline heredoc through a
  background wrapper mangles quoting (repos-y9fat) and the reviewer receives a
  truncated question.

Prefer `bg_pi_query` when it launches: its `maxToolCalls` is a *hard* cap, while
  a prompt's budget is only self-enforced by the reviewer.

## Failure ledger (measured, 2026-11-20)

| Run | Configuration | Outcome | Cause |
| --- | --- | --- | --- |
| repos-cbjw5 | review run | killed silently by the harness | harness, no verdict |
| qfz0 R1 | `pi -p`, requested `ollama-cloud/fast`, 18 calls, 25 min | SIGTERM at flat 1500 s, 50-byte output | no budget, slow model, flat timeout |
| qfz0 R1 (model id) | same id re-probed 20:30Z | `404: model "fast" not found` | `fast` is a **v100** lane, not an ollama-cloud model; the id never resolved cleanly |
| qfz0 R2 | same, REV 3 prompt | `FATAL: REV 3 does not exist in the code` | artifact status not stated — it reviewed a design as code |
| qfz0 R6/R7 | narrowed 5-question prompt, deepseek-v4-pro, 2400 s | verdict returned | budget + forced verdict + narrow scope |
| qfz0 R8 | two parallel runs, `Cap: 40 tool calls`, glm-5.3, 4200 s | 2/2 verdicts, both `ATTACKS` with reproducible inputs | this contract, first time applied end to end |

The R8 pair is the benchmark: both runs finished inside budget, both produced a
verdict, and both attacks were reproducible by hand from the findings text.

**Model policy (operator 2026-11-20 23:0xZ, verbatim: "ollama-cloud/glm-5.3 is banned").**
No glm-5.x is a default anywhere in this contract. The default reviewer model is now
`ollama-cloud/deepseek-v4-pro:0813` (`bin/defend-ask`, overridable per run with `--model`;
the ban applies to overrides too). The dated rows above name the models that were used when
they ran, including glm-5.3 in R8 — that row is a measurement, not a default, and is kept so
the benchmark can be reproduced. Re-running the R8 benchmark today means re-running it on
`deepseek-v4-pro:0813` and recording the new pair beside the old one.

## Provenance

Written by inference-lead after the qfz0 gate review rounds; the ledger entries
are from `repos-18bvp`, `repos-cbjw5` and the qfz0 design's provenance section.
If you change the timeout arithmetic or the contract items, update the ledger
row that justifies it — the numbers in this file are the evidence, not decoration.
