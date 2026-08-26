---
name: cli-proxy
description: Local OpenAI-compatible LLM endpoint http://127.0.0.1:8091/v1 routing via arc-llm-proxy. Requires API key. Use whenever code or a pipeline needs an LLM API endpoint.
---

# cli-proxy

OpenAI-compatible `/v1/chat/completions` at `http://127.0.0.1:8091/v1`. Routes via arc-llm-proxy switchboard. Requires API key. No API keys burned (extra-usage off).

## Model names

- `<project>/<alias>` — e.g. `arc-shopper/easy`, `you/hard` (see `switchboard.default.json`).
- Bare alias (no `/`) resolves against `defaultProject` (see `switchboard.default.json`).
- `<alias>#[slow|fast]` — effort/speed suffixes override the alias's first endpoint.
- `smart` — pool alias (priority failover, first success wins).
- `fast` — pool alias (priority failover).

Effort levels: `non`, `no-think` (0 tokens), `low`, `med`, `high`, `xhigh`, `max`.

## Rules

- Use `arc-llm-proxy.service` as the systemd service. Restart needs authorization — don't bounce it speculatively.
- Always include `x-api-key: <key>` or `Authorization: Bearer <key>` header. `/health` is open.
- Production pi-headless workers use `pi --model arc-proxy/<alias>`; diagnostics/self-healing subagents do NOT (use `arc-llm-proxy` directly with explicit headers).
