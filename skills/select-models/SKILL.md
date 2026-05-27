---
name: select-models
description: One-time setup that discovers reachable model providers (env vars + pass store), asks the user to pick a fast and a smart model, validates each by actually invoking the CLI, then writes ~/.config/arc-skills.json. Use when first installing arc-skills, when no ~/.config/arc-skills.json exists, or when the user wants to change which fast/smart models the arc tooling uses. arc-skills is the base layer; arc-agents, arc-webui, pipeliner and other arc-* packages read this config.
---

# select-models

arc-skills is the base install. Every other arc-* system (arc-agents, arc-webui, pipeliner) needs to know **which two models to use**: a *fast* one for cheap high-volume work and a *smart* one for the few high-stakes steps. This skill discovers what's available on the machine, lets the user choose, validates the choice by running it, and writes the shared config that everything else reads:

```
~/.config/arc-skills.json
{
  "version": 1,
  "models": {
    "fast":  { "engine": "claude"|"pi", "command": "<cli> … {prompt}" },
    "smart": { "engine": "claude"|"pi", "command": "<cli> … {prompt}" }
  }
}
```

`{prompt}` is the substitution point — a consumer replaces it with the actual prompt. The skill is the **only** place model selection lives; skills and systems reference `models.fast` / `models.smart`, never re-derive them.

## Procedure

### 1. Discover providers

Run the discovery script. It checks env vars and the `pass` store and prints a table.

```bash
bash ~/.claude/skills/select-models/scripts/discover.sh
```

Each line is `<provider>\t<source>\t<status>`. Treat only `status=ok` rows as usable. Possible providers: `anthropic` (built-in `claude` models: opus/sonnet/haiku, or a logged-in `claude` CLI), `minimax`, `openrouter`, `chutes`.

### 2. Build candidate CLI templates

From the reachable providers, form candidate command templates. Each MUST contain `{prompt}` exactly once. Known-good shapes:

| Provider | Engine | Fast template | Smart template |
|---|---|---|---|
| anthropic | claude | `claude --model haiku {prompt}` | `claude --model opus --effort max {prompt}` |
| minimax | pi | `pi -p --provider minimax --model MiniMax-M2.7 --thinking low {prompt}` | `pi -p --provider minimax --model MiniMax-M2.7 --thinking high {prompt}` |
| openrouter | pi | `pi -p --provider openrouter --model <model> {prompt}` | `pi -p --provider openrouter --model <model> {prompt}` |

Rule (matches arc-agents config validation): a `claude --model X` template is only valid when `X ∈ {opus, sonnet, haiku}`. Provider models (minimax, etc.) MUST run through `pi -p --provider …`, never `claude --model`.

### 3. Ask the user to choose

Use AskUserQuestion with two questions — one for the **fast** model, one for the **smart** model — offering only templates backed by a reachable provider. Recommend: fast = cheapest high-throughput option (haiku or minimax-low); smart = most capable (opus-max). If only one provider is reachable, you may still split fast/smart by its own tiers (e.g. minimax low vs high thinking).

### 4. Validate each pick by running it

Before writing anything, confirm each chosen template actually works:

```bash
bash ~/.claude/skills/select-models/scripts/validate.sh '<fast-template>'
bash ~/.claude/skills/select-models/scripts/validate.sh '<smart-template>'
```

Each substitutes a trivial health-check prompt, runs the CLI, and exits 0 only if it returned text. If validation fails, tell the user which one failed and the stderr tail, then either pick a different candidate or stop — **do not write a config with an unvalidated model.**

### 5. Write the config

Only after both validate:

```bash
bash ~/.claude/skills/select-models/scripts/write-config.sh \
  <fast-engine>  '<fast-template>' \
  <smart-engine> '<smart-template>'
```

It writes `~/.config/arc-skills.json` atomically (temp + rename) so a crash never leaves a half-written file. The script echoes the result — show it to the user.

### 6. Confirm

- [ ] `~/.config/arc-skills.json` exists and parses (`jq . ~/.config/arc-skills.json`)
- [ ] Both `models.fast.command` and `models.smart.command` contain `{prompt}` once
- [ ] Both were validated in step 4

## Notes

- **Idempotent.** Re-running just overwrites the config with freshly validated picks — safe to run anytime the user wants to switch models.
- **Why validate by invoking, not by key-presence:** a key can be present but expired, rate-limited, or the CLI misconfigured. Running a one-token probe is the only honest check that the model will actually answer.
- **Consumers** (pipeliner, arc-agents spawn, dream's collector/adapter) read `models.fast`/`models.smart` from this file. They should fall back gracefully (e.g. to a built-in `haiku`/`opus`) if the file is absent, and point the user here.

## Related

- `dream` — its `collector` (fast) and `adapter` (smart) subagents map directly onto these two handles; see `skills/dream/SETUP.md`.
