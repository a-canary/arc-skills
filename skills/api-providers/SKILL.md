---
name: api-providers
description: LLM/API provider registry — pass-store key paths, endpoints, per-provider model availability + warm status, intelligence scores, per-model notes, and routing guidance. Use when code or an agent needs an API key, is picking a provider/model for a job (interactive vs background/cron), or asks what models are available or warm — check the live doc before choosing.
---

# api-providers

Keys live in the GPG `pass` store. Never inline; pull at use: `pass show api/<provider>/<entry>`.

## Keys + endpoints

| Provider | pass path | Base URL | Auth |
|---|---|---|---|
| anthropic | `api/anthropic/api-key` | https://api.anthropic.com/v1 | `x-api-key` + `anthropic-version: 2023-06-01` |
| minimax | `api/minimax/api-key` | https://api.minimax.io/v1 | Bearer |
| openrouter | `api/openrouter/api-key` | https://openrouter.ai/api/v1 | Bearer |
| featherless | `api/featherless/api-key` | https://api.featherless.ai/v1 | Bearer |
| chutes | `api/chutes/api-key` | https://llm.chutes.ai/v1 | Bearer |
| cerebras | `api/cerebras/api-key` | https://api.cerebras.ai/v1 | Bearer |
| claude (OAuth) | `api/claude/oauth-token` | via cli-proxy http://127.0.0.1:7890/v1 | Max quota — no per-token cost (see `/cli-proxy`) |
| huggingface | `api/huggingface/token` | huggingface.co hub | model downloads, gated repos |
| vast | `api/vast/api-key` | vast.ai CLI | GPU leasing (see `/vast-cli`, `/vast-compute`) |

All chat providers are OpenAI-compatible (`POST <base>/chat/completions`) except anthropic (native Messages API).

## Live doc (daily-refreshed)

`~/vault/api/PROVIDERS.md` — per-provider model tables: availability, warm status, context length, intelligence score, memory-notes. Refreshed daily by cron running `refresh.ts` (this skill dir); see `SETUP.md`.

The doc is GENERATED. Source of truth is `~/vault/api/models.json` (watchlist, intel scores, notes). To add a model, bank a note, or record a score: edit `models.json`, then `bun ~/repos/arc-skills/skills/api-providers/refresh.ts`. Intel = curated score (Artificial Analysis index or internal ProgramBench) — filled by hand when measured, never guessed.

## Featherless limits (three separate caps — plan `feather_pro_plus`)

Featherless serves ~22k models by cold-loading weights onto shared GPUs on demand.
Three independent throttles, all per API key:

1. **Concurrency** — 4 units of *simultaneous* in-flight requests. Big models cost
   more units (DeepSeek-V3.2 = 4 units = the whole cap, so any overlap 429s).
2. **Model-switch rate** — **≤4 *distinct* models loaded per rolling 60s window.**
   The 5th different model in a minute gets `429 "only allows you to switch models
   4 times per minute"`. **Same-model repeats are FREE** (verified: 6 back-to-back
   same-model calls all 200; the 5th *distinct* model tripped it). A gated/errored
   model that never loads doesn't count against the 4.
3. **No token cap** — tokens are effectively unlimited.

**What the switch cap breaks** (route these to chutes instead — its ~14 models are
all always-hot, no cold-load, switch freely):
- Thompson-sampling / bandit over a >4-model pool on one key — 429s within seconds
  if a new arm is pulled every call. Workarounds: cap the live arm-set to ≤4, rotate
  the pool at minute granularity, or shard arms across keys.
- Expert-horde with >4 distinct judges; rapid A/B model sweeps.
- It does NOT break a fixed small set: KE=model-X + agent=model-Y is 2 switches,
  never trips. It only bites when the *set touched in a minute* exceeds 4.

**Strategy — nightly 4-slot assignment.** Because the cap is 4 distinct models, pick
4 role slots each night and alias them (env var / config), then stick to that set all
day — you're under the switch cap by construction. The daily `refresh.ts` run updates
availability + warm status first; a follow-on step assigns slots from the warm list by
reading benchmark leaderboards + HF model cards. Slot shape (roles, not fixed ids —
ids are the nightly output, verified against that day's warm list):
```
best:   <top general>      # e.g. GLM-5.2 / DeepSeek-V4-Pro
reason: <best reasoner>    # small strong-reasoning model
coder:  <best coder>       # e.g. Qwen3-Coder-Next, Kimi-K2.7-Code
reader: <cheap long-ctx>   # e.g. DeepSeek-V4-Flash — bulk read/summarize
```
Any workload then draws only from these 4 → never 429s on switch. (Slot ids in the
user's original example were illustrative; the nightly job picks + verifies real warm
ids, since the featherless catalog is fresher than the API registry.)

## Routing

- **featherless is concurrency-capped + switch-rate-capped, NOT token-capped** → preferred for non-urgent, slow-burn, background, and cron jobs on a SMALL FIXED model set (≤4 distinct/min): arc-factory testing + optimization sweeps, expert-horde judge panels. Tokens are effectively unlimited; never put latency-sensitive, highly-parallel, or wide-model-fanout (Thompson/bandit >4 models) work on it — see Featherless limits above.
- **Short-context model** → route through pipeliner (`/pipeliner`): decompose into chained small modules instead of one long prompt — cheap short-context models stay usable.
- Interactive / frontier work → cli-proxy pool aliases `smart`/`fast` (Max quota) or anthropic/minimax direct.
- Bulk cheap tokens on hot open models → chutes. Long-tail model variety → openrouter or featherless.
- No LiteLLM / multi-key proxies — direct API only, route via pipeliner/config (USER.md doctrine).
