# Ask-the-operator inventory (2026-11-07)

Operator ruling 2026-11-07: webui /decide replaces and supersedes agents asking questions in chat.
Every place an agent asked the operator anything, before the pivot, and what we keep.
Verdicts: **steal** = keep as is in the /decide flow, **adapt** = keep the idea in a new form, **drop** = retire.

## Use cases

| Where | How it asked | Verdict | Now |
| --- | --- | --- | --- |
| director "Stop and interview" | live chat, one question at a time; /decide only when AFK | adapt | always /decide; one card per open design question, park that thread |
| grilling | chat, one question at a time, wait for each | adapt | one card per decision; independent branches post in parallel, dependent ones chain with `--blocks` |
| mission-metrics, wayfinder HITL tickets, market-comparison grilling steps | chat grilling | adapt | grilling via cards, same as above |
| agent-mode director objective | "interview the operator" | adapt | via cards |
| select-models | AskUserQuestion, two questions | adapt | two cards (fast model, smart model) |
| execute-wargame, wargame EXECUTE | stop and ask in chat for unresolved variables | adapt | one card per unresolved variable, or one "authorise assumed values" card |
| request-refactor-plan, write-a-skill | ask the user in chat | adapt | cards |
| diagnose HITL bash script | human runs a script while the agent watches | adapt | `decide task` card ("Will you run …today?"), the script output comes back as the reply note or a file |
| dream usersig | bead labelled `usersig,review` in the cwd db, never on /decide | adapt | `decide task` card linking the proposal |
| overseer escalation | bead in the director db, not on /decide | adapt | card in the repo db |
| objective-counsel-approval human-gate verdict | ledger feedback row, source objective-counsel, invisible | adapt | card; the ledger row stays as LOG audit |
| auto-oversight merge check | greps ledger OPEN gate rows only | adapt | also checks open `human` cards citing the PR |
| llm-hosting llm-shopper weekly scan | ledger feedback row source=human-gate (legacy queue) | adapt | card (bead filed for llm-hosting) |
| arc-agents gate-triage | Opus pre-triages ledger human-gate rows | drop with the legacy queue | cards need no triage: the lint and the §0 filter run before posting |
| workbench write-lane unlock | operator writes a ledger `lane-approve` event | keep, link | the agent posts a card; the unlock stays an operator-written event (an agent writing it is forgery) |
| webui legacy ledger gates (feedback, HITL issues, PRD review) | collapsed section on /decide | drop once no writer is left | bead filed for arc-webui |
| berzerk | /counsel, never AskUserQuestion | steal | unchanged; a genuine operator fork becomes a card |
| GLOBAL-RULES public exposure, constitutional changes | "file a human bead and wait" | adapt | one always-on rule; "wait" means hold that action, keep working elsewhere |

## Techniques

| Technique | Source | Verdict |
| --- | --- | --- |
| one question at a time | grilling, mission-metrics | adapt: one decision per card; the card is the unit |
| recommend an answer with each question | grilling, `rec="1"` | steal: the first `--opt` is the recommendation |
| look facts up instead of asking | grilling, §0 filter | steal |
| research before each question | director | steal: cite it in Evidence |
| latency test (gate only when the wait costs less than the option delta) | human-gate-post-webui §1 | steal |
| /counsel before asking | GLOBAL-RULES, berzerk | steal: implementation forks never reach a card |
| task cards Done / Not now | human-gate-post-webui | steal: `decide task` |
| card lint (caps, no SHAs or paths up top) | lint-card.ts | steal: `decide ask` runs it, a failing card cannot post |
| close and re-post instead of appending | human-gate-post-webui | steal: `--replaces` |
| block your bead on the gate | `bd dep add` | steal: `--blocks` |
| reply verbs (accept/reject/reply/refresh/skip/defer) | /decide | steal: `decide answers` parses them |
| live back-and-forth, "do not enact until shared understanding" | grilling | adapt: the last card of a grilling run asks "Shared understanding reached?" |
| AskUserQuestion, chat-only questions | harness | drop |
| ledger feedback rows as gates | legacy | drop |
| Opus triage of gates | gate-triage | drop |
