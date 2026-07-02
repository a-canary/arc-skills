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
| claude (OAuth) | `api/claude/oauth-token` | via cli-proxy http://127.0.0.1:7890/v1 | Max quota — no per-token cost (see `/cli-proxy`) |
| huggingface | `api/huggingface/token` | huggingface.co hub | model downloads, gated repos |
| vast | `api/vast/api-key` | vast.ai CLI | GPU leasing (see `/vast-cli`, `/vast-compute`) |

All chat providers are OpenAI-compatible (`POST <base>/chat/completions`) except anthropic (native Messages API).

## Live doc (daily-refreshed)

`~/vault/api/PROVIDERS.md` — per-provider model tables: availability, warm status, context length, intelligence score, memory-notes. Refreshed daily by cron running `refresh.ts` (this skill dir); see `SETUP.md`.

The doc is GENERATED. Source of truth is `~/vault/api/models.json` (watchlist, intel scores, notes). To add a model, bank a note, or record a score: edit `models.json`, then `bun ~/repos/arc-skills/skills/api-providers/refresh.ts`. Intel = curated score (Artificial Analysis index or internal ProgramBench) — filled by hand when measured, never guessed.

## Routing

- **featherless is concurrency-capped, NOT token-capped** → preferred for non-urgent, slow-burn, background, and cron jobs: arc-factory testing + optimization sweeps, expert-horde judge panels. Tokens are effectively unlimited; just never put latency-sensitive or highly-parallel work on it.
- **Short-context model** → route through pipeliner (`/pipeliner`): decompose into chained small modules instead of one long prompt — cheap short-context models stay usable.
- Interactive / frontier work → cli-proxy pool aliases `smart`/`fast` (Max quota) or anthropic/minimax direct.
- Bulk cheap tokens on hot open models → chutes. Long-tail model variety → openrouter or featherless.
- No LiteLLM / multi-key proxies — direct API only, route via pipeliner/config (USER.md doctrine).
