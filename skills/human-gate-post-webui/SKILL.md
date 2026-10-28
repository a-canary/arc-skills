---
name: human-gate-post-webui
description: 'Surface a genuine human-gate or taste choice to the developer via webui /decide without blocking on the reply. Rare by design; most uncertainty self-resolves via docs/ke/counsel. Use only when a decision is genuinely the human''s. Triggers: "surface this to the developer", "post a human-gate", "this needs Aaron''s call", "flag a taste choice".'
---

# Human-Gate-Post-Webui

The **non-blocking** channel for the rare decision only the developer can make.
A bead labelled `human` is the async surface: webui `/decide` shows one card at
a time and the developer answers on their approve/deny cadence. This skill posts the gate and **returns
you to other work in the same breath** — it is a note left on the board, never a
wait.

ADR-0011 (question-free execution): executing agents may not *ask and wait*.
Post-PRD uncertainty self-resolves via **docs · ke-research · /counsel**. This
skill is the narrow exception ADR-0011 keeps: a problem genuinely un-self-
resolvable is *posted to /decide*, then execution continues elsewhere. If you
find yourself reaching for this more than rarely, the gate belongs earlier (in
planning Chat / a reference artifact), not mid-execution.

## 0. Is this actually a human-gate? (the filter)

Most things that *feel* like a gate are not. Before posting, rule out:

- **Self-resolvable** — docs, ke:recall, or /counsel can decide it. Then DO
  that; don't post. /counsel is the named substitute for the user on most forks
  ([[counsel-over-asking]]).
- **A default exists** — reversible + a sensible default? Take the default,
  note it in one line, proceed. A gate is for decisions with no safe default.
- **Not the human's to make** — a fact you can verify in the repo, a choice the
  code/CHOICES.md already settles. Verify, don't ask.

Post ONLY when the decision is genuinely the developer's: an irreversible or
outward-facing action, a taste/direction call with no right answer, or a
**human-gated class** — gate-removal, spend, publish, delete, account
([[hard-merge-standing-permission]] carve-outs). These are the real gates.

## 1. The latency test — is the gate cheaper than the wait?

The whole point. A human-gate costs **human-reply latency** (hours; on the
mobile cadence ~2-4h, overnight far longer). Before posting a *choice between
options*, price the wait against the options:

> Option A (5 min + $1) vs Option B (1 hr + $0), but the human is ~12 h away —
> waiting cost more than either option. You should have just PICKED one.

Rule: **if the wait costs more than the delta between the options, don't gate —
pick the reversible/cheaper-to-undo option and proceed**, logging the choice +
why you didn't wait (LOG row, not OPEN). Gate only when the options are
expensive or irreversible *enough that human-reply latency is the smaller cost*
— i.e. picking wrong is costlier than waiting. Spend/publish/delete/account
gates are (almost) always worth the wait because picking wrong is
irreversible; a two-way-door implementation choice almost never is.

State the latency reasoning in the post so the developer sees you did the math.

## 2. Write the gate — one `human` bead

One bead in the shared `~/repos` db (or the repo's own db if it keeps one). The
developer reads it on mobile ([[response-style-caveman]]): `/decide` shows the
question, options and recommendation; everything from the first `Footnotes:` /
`Evidence:` / `Tech:` / `---` line on folds behind "more".

```
bd create "<repo>: <the decision in a few words>" -p <0-3> -t decision -l human \
  -d "Q: <request/scope-change in 1-2 lines>?

Options:
A) <option> — <cost>
B) <option> — <cost>

Recommendation: <A|B> — <one line why>.

Evidence: <facts that make it a gate, file:line refs>
Latency: <why gated not defaulted (§1 math)>
Meanwhile: <the unblocked work you moved to>"
```

- Option lines `A) …` / `B) …` become the card's buttons; keep them one line each.
- If your work depends on the answer, `bd dep add <your-bead> <gate-bead>` so it
  drops out of `bd ready` until decided.
- Never write ledger `feedback` rows (source='human-gate') or HITL `issues` for
  this — that legacy queue is folded away on /decide and nobody reads it (aw3-rsn).
- A gate is a **measurement** (UM-0500): cite real `file:line`/data, never a
  fabricated number to make the gate look urgent. Nothing to decide, only to log?
  `bd note` your own bead — no gate.

## 3. Keep moving — the non-negotiable half

The post is fire-and-forget. **Do NOT wait, poll, or ScheduleWakeup to check for
a reply.** Immediately:

1. **Find unblocked alternatives** — other issues on the board, other slices of
   the same PRD that don't depend on this decision, the next repo in the walk.
2. **Explore around the gate** — prototype BOTH options cheaply if that de-risks
   the eventual answer (a paper-prototype of each, thrown away when the human
   picks). Exploration that makes the human's choice better-informed is itself
   progress.
3. **Batch gates** — if several gates accrue, they land together on the
   developer's next cadence pass; that's fine. Don't serialize your own work on
   them.

The developer's reply arrives async: `/decide` swaps `human`→`decided` and adds a
`DECISION <verb>: …` comment (`bd list --label decided`, `bd comments <id>`), or
a fresh instruction — you act on it *when it comes*, not by blocking now. A gate
that stalled the agent until the human replied is a broken use of this skill
(it re-couples throughput to human latency, the exact thing ADR-0011 cut).

## Judging done

One concise `human` bead per genuine gate, the §1 latency math shown, evidence
cited real, and the agent already working something else by the end of the same
turn. A run that posted a self-resolvable question, wrote a ledger feedback row,
gated a defaultable choice, or *waited* for the reply is broken — redo it.
