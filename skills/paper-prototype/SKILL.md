---
name: paper-prototype
description: Hand-execute a designed module's process end-to-end BEFORE writing its code — walk each step manually with live or near-production data, using only existing APIs and proven code, writing md/json/csv/html intermediate files. Produces a vetted spec delta: validated step contracts, discovered submodules, dependency list, and spec revisions. Use when a module spec/API design exists but implementation hasn't started, when the user says "paper prototype", "hand-execute the design", "desk-check the spec", or before /to-issues on an unproven design.
---

# Paper Prototype

Hand-execute the designed process step-by-step, on real data, before any code exists.
The deliverable is not working software — it is a **spec delta**: the spec as corrected
by reality, plus the submodules and dependencies reality forced you to name.

## Hard rules

- **No new code.** Call only existing APIs, proven CLIs, deployed services, shell
  one-liners for data movement (curl/jq/sqlite3/grep). If a step is impossible
  without new code, that is a *finding*, not a blocker — name the submodule, write
  its contract, stub its output by hand, continue.
- **Live or near-production data only.** Real API responses, real DB rows, real
  files. Invented sample data proves nothing; the whole point is that real data
  breaks assumptions.
- **Every step leaves an artifact.** Each step's output is an md/json/csv/html file
  on disk. You (the agent) are the runtime; the files are the memory between steps.

## Process

Work in `<repo>/.paper/<module>/` (gitignored or committed — spec author's call).

1. **Decompose the spec.** Read the module spec/API design. Write `00-plan.md`:
   the process as an ordered list of steps, each with declared input, output, and
   the existing API/tool expected to serve it. Unknowns marked `?`.

2. **Hand-execute each step N:**
   - Acquire real input: call the actual API, query the live DB, read the prod file.
     Save raw input as `NN-<step>-in.<ext>`.
   - Manually produce the step's output per the spec — transform, judge, format —
     and save as `NN-<step>-out.<ext>`. Use html when a human should eyeball it
     (render tables/diffs), json/csv for data handed to the next step, md for
     judgment/notes.
   - Append to `NN-<step>-notes.md`: what the spec said vs what you actually had
     to do; data shapes that differed; auth/rate/latency surprises; every decision
     the spec left you to improvise (each improvisation = a missing spec clause).

3. **When a step needs code that doesn't exist:** record in notes —
   `SUBMODULE: <name> — in: <shape> out: <shape> because: <what you did by hand>`.
   Then produce its output by hand and keep walking. The hand-labor you performed
   *is* the submodule's functional spec.

4. **Chain to the end.** Feed each step's `-out` file as the next step's input.
   If a later step invalidates an earlier output, revise the earlier artifact and
   note the feedback loop — those loops are the spec's hidden cycles.

5. **Write the spec delta** — `SPEC-DELTA.md`, the sole deliverable:
   - **Validated flow**: steps as actually executed, with real data shapes
     (link each step's artifacts as evidence).
   - **Submodules**: every `SUBMODULE:` line, deduped, with contracts.
   - **Dependencies**: every external API/service/table/file actually touched,
     with auth mode and observed quirks.
   - **Spec revisions**: numbered diffs against the original spec — wrong
     assumptions, missing clauses (from improvisations), dead steps.
   - **Open questions**: what one manual pass couldn't settle (scale, concurrency,
     failure modes only volume reveals).

Then update the original spec/CHOICES/ADR from the delta, or hand SPEC-DELTA.md
to /to-issues — each submodule is a natural vertical-slice issue.

## Judging done

One full end-to-end pass with real data, every step evidenced by artifacts, and a
SPEC-DELTA.md whose revisions section is non-empty. A paper prototype that found
zero spec revisions was run on invented data or skipped the hand-execution — redo
the suspect steps.
