---
name: human-gate-post-webui
description: 'Surface a genuine human-gate or taste choice to the developer via webui /decide without blocking on the reply. Rare by design; most uncertainty self-resolves via docs/ke/counsel. Use only when a decision is genuinely the human''s. Triggers: "surface this to the developer", "post a human-gate", "this needs the developer''s call", "flag a taste choice".'
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
why you didn't wait (`bd note` on your own bead, no gate). Gate only when the options are
expensive or irreversible *enough that human-reply latency is the smaller cost*
— i.e. picking wrong is costlier than waiting. Spend/publish/delete/account
gates are (almost) always worth the wait because picking wrong is
irreversible; a two-way-door implementation choice almost never is.

State the latency reasoning in the post so the developer sees you did the math.

## 2. Write the gate — one `human` bead in the `<decide>` schema

One bead in a db `/decide` scans: `~/repos` itself, or a `~/repos/<name>` that
keeps its own `.beads/embeddeddolt`. Pass `-C` explicitly — run from `~` and
`bd` resolves to `~/.beads`, which `/decide` never reads. The developer reads it
on mobile, one card at a time: concise context, a clear question, and options
whose trade-offs are stated (operator 2026-10-28).

Write the description to a file, then `bd -C ~/repos create "<repo>: <the decision in a few words>" -p <0-3> -t decision -l human --body-file <file>`:

```
<decide><q>Which model may the agent-pub container use?</q><context>agent-pub moves into a rootless container whose only network path is the lane proxy. Example: today a review shells out to Claude Opus; inside the container that call has no route unless we give it one.</context><option id="A" rec="1" title="Keep Opus">Reviews keep today's quality. Costs Claude budget and puts a Claude credential inside the container.</option><option id="B" title="Qwen only (V100)">No Claude spend and nothing secret in the container. Weaker reviews on hard diffs.</option></decide>

Evidence: <facts that make it a gate, file:line refs>
Latency: <why gated not defaulted (§1 math)>
Meanwhile: <the unblocked work you moved to>
```

Rules (`/decide` renders the card from them, and shows `card malformed: <why>` in red when broken):

- `<q>`: exactly one question, ending `?`. It is the card's headline.
- `<context>`: why now, plus one concrete example, ≤6 lines, in plain words. No unexplained bead ids, file paths or jargon — the reader has not seen your session. It is folded by default.
- `<option>`: 2-5, each with a unique `id` A-E and a `title` of ≤5 words. The body is 1-2 sentences naming the gain AND the cost. An option with no stated cost is not a trade-off.
- `rec="1"` on at most one option, the one you would pick.
- Text after `</decide>` (Evidence/Latency/Meanwhile) folds behind "details".
- If your work depends on the answer, `bd dep add <your-bead> <gate-bead>`: it
  drops out of `bd ready` until the gate bead is **closed** — deciding alone
  leaves it open, so close it once you have acted on the answer (§3).
- Never write ledger `feedback` rows (source='human-gate') or HITL `issues` for
  this — that legacy queue is folded away on /decide and nobody reads it.
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

The developer's reply arrives async as a comment on the bead (`bd list --label decided`, `bd comments <id>`). What each button means for you:

| Comment | Bead state | You do |
| --- | --- | --- |
| `DECISION accept <X>: <note>` | `human`→`decided` | Execute option X (the note refines it), then `bd close <gate> --reason "<what you did>"` so dependents unblock. |
| `DECISION reject: <note>` | `human`→`decided` | Drop the proposal; the note usually says why. Close with the reason. |
| `DECISION reply: <text>` | `human`→`decided` | They deferred WITH a question or concern. Answer it; if a decision remains, close this bead and post a NEW card that resolves the concern ("replaces <old-id>"). |
| `DECISION refresh` | un-deferred, `decided` | They pulled it back from the revisit list. Still relevant? Moot → close with the reason; else rewrite to current facts and swap `decided`→`human`. |
| `DECISION skip` | still `human`, back of the queue | Nothing — they will see it again. Do not re-post it. |
| `DECISION defer until +Nd` | `deferred`, keeps `human` | Nothing until it resurfaces. Leave it open. |

Remove `decided` once you have handled a decision. Or a fresh instruction arrives — you act on it *when it comes*, not by blocking now. A gate
that stalled the agent until the human replied is a broken use of this skill
(it re-couples throughput to human latency, the exact thing ADR-0011 cut).

## Judging done

One concise `human` bead per genuine gate in the `<decide>` schema (renders without `card malformed`), the §1 latency math shown, evidence
cited real, and the agent already working something else by the end of the same
turn. A run that posted a self-resolvable question, wrote a ledger feedback row,
gated a defaultable choice, or *waited* for the reply is broken — redo it.
