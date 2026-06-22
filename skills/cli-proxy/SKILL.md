---
name: cli-proxy
description: Local OpenAI-compatible LLM endpoint http://127.0.0.1:7890/v1 routing to claude/gemini/qwen/kilo/opencode CLIs + minimax API. Use whenever code or a pipeline needs an LLM API endpoint.
---

# cli-proxy

OpenAI-compatible `/v1/chat/completions` at `http://127.0.0.1:7890/v1`. Routes Max-quota OAuth CLIs — no API keys burned (extra-usage off).

## Model names

- `cli/<tool>[/<model>]` — tools: `claude`, `gemini`, `qwen`, `kilo`, `opencode`. E.g. `cli/claude/sonnet`, `cli/claude/haiku`, `cli/gemini`.
- `minimax[/<model>]` — direct MiniMax API (default MiniMax-M2.7).
- `pi/<alias>[/<effort>]` — pi CLI multi-provider. Current alias: `minimax-m3` → `minimax/MiniMax-M3`.
- `smart` — pool alias (priority failover, first success wins): `cli/claude/fable/high` → `cli/claude/opus/high` → `pi/minimax-m3/high`.
- `fast` — pool alias (priority failover): `pi/minimax-m3/no-think` → `cli/claude/sonnet/no-think`.

Effort levels: `non`, `no-think` (0 tokens), `low`, `med`, `high`, `xhigh`, `max`. For `pi`, effort maps to `:thinking` suffix.

## Rules

- NEVER send system-role messages to `cli/claude/*` — refused. Fold system text into the user turn.
- Service: systemd user unit `cli-proxy.service`. Restart needs authorization — don't bounce it speculatively.
- Production pi-headless workers use these provider aliases; diagnostics/self-healing subagents do NOT (opus/haiku via Task only).
