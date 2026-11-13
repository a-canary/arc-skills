---
name: ask-claude
description: Thin cross-model call — no tools, no context, one turn. stdin | claude -p --model fable --effort low --allowedTools "". Use for counsel escalation, or any second opinion, or any second opinion that must be disjoint from your model AND your context. Not for merge review — DefendMerge goes through defend-attack.
---

# ask-claude — cross-model text-to-text transport

One Fable call at low effort. No tools. No shared context. One turn. The input you pipe in is
all it sees; the stdout it returns is all you get. Context isolation is the
point — never drop `--allowedTools ""`.

## Invocation

```sh
<artifact + attack frame> | ENABLE_CLAUDEAI_MCP_SERVERS=false claude -p --model fable --effort low --max-turns 1 --allowedTools "" --tools "" --strict-mcp-config
```

- **Input**: the full text of the artifact under attack, plus the attack frame
  (gate rubric from `defend/`, or the counsel report). If the artifact is a
  diff, pipe the diff file contents — Opus gets text, not tool access.
- **Output**: a verdict in the contract shape below. If the shape is wrong,
  re-run once with "respond strictly in this shape: …". Never parse prose
  hopelessly — enforce the contract.
- **Auth**: the machine's normal `claude` login. The pass OAuth token is org-blocked; do not load it.
- **No tools**: `--tools ""` drops built-ins only; `--strict-mcp-config` and `ENABLE_CLAUDEAI_MCP_SERVERS=false` drop MCP and claude.ai connector tools, which otherwise cost a second turn and fail `--max-turns 1`.
- **Model tier per gate**: DefendPlan = counsel panel, DefendMerge = `defend-attack` (see
  defend/merge.md — the local model scouts, then Fable at low effort attacks every diff), DefendDeploy = counsel panel.

## Verdict contract (all callers)

```
CLEAR | ATTACKS
attacks: ranked list, severe-first. Each item:
  - the finding (one line, cite the artifact location)
  - what would satisfy it (evidence X / test Y / change Z)
  - lens: <rubric lens name> | free
```

Overrides of ATTACKS are logged as ledger `event`s, never silent — naming the
gate, the attacks overridden, and why. A CLEAR from Opus is still an
untrusted subagent report — verify checkable claims against source before
acting.

## Cost rule

Fable (low effort) is spent only at named junctions (defend gates, counsel escalation).
Routine review, planning ticks, and worker lanes run on the workhorse model.
If you are about to call ask-claude outside a named junction, stop and check
whether the workhorse tier is proportionate.
