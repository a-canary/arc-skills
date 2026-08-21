---
name: slow-lane
description: Route LLM calls for long-running, non-user-facing work through the idle-llm-proxy slow lane (http://192.168.1.103:8081 with a #slow model-name suffix) so it queues behind the local llama-server's idle slots instead of stealing them from interactive work. Use for any background/batch/agent LLM call — cron jobs, pipelines, subagent work, ETL, generation — and NOT for user-facing/interactive requests (those hit the same endpoint without the suffix, or use the CLI proxies).
---

# slow-lane

The local model box (192.168.1.103) runs llama-server (Bonsai-27B, multimodal) on `:1234` behind `idle-llm-proxy` on a single port:

- `http://192.168.1.103:8081` — the only endpoint. Routing is by model name:
  - model ending in `#slow` → **slow lane**: queues, dispatches only into idle slots, always reserves headroom for fast traffic.
  - anything else → **fast lane**: immediate passthrough, never queues.

## Rule

Long-running or non-user-facing LLM calls append `#slow` to the model name. If it would wait, let it wait — that is the point. Never hit `:1234` directly from other work; you'd bypass the queue and starve interactive requests.

## Usage

```bash
curl -s http://192.168.1.103:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-User: my-job' \
  -d '{"model":"Bonsai-27B-Q1_0.gguf#slow","max_tokens":512,"messages":[{"role":"user","content":"..."}]}'
```

- OpenAI-compatible; the proxy strips the `#slow` suffix before forwarding, so upstream sees the plain model name.
- `X-User` header: per-user round-robin fairness — with several clients queued, dispatch alternates one request per user per cycle. Set it to something identifying (job name, agent name); it falls back to `default` when absent.
- Vision works (`image_url` with data-URL or URL content parts).
- The model is a thinking model: reasoning consumes `max_tokens` before `content`. Budget accordingly (20 tokens ≈ empty content).
- Set generous client timeouts — `#slow` requests block in the queue until a slot frees.
- Ops: `GET :8081/__queue` → `{"queue":N,"inflight":N,"lastIdle":N}`; `GET :8081/health` → `{"ok":true}`.

## Box ops

- Proxy: `C:\repos\idle-llm-proxy\` on the box, start via `start-proxy.bat` (or `wmic process call create "cmd /c C:\repos\idle-llm-proxy\start-proxy.bat"` over ssh; kill by PID only — the box runs other node.exe processes). Source of truth: `~/repos/idle-llm-proxy` (git).
- llama-server must be started with `--mmproj mmproj-Bonsai-27B-BF16.gguf` for vision; a restart without it silently drops multimodal.
- Single slot (`-np 1`): one slow request at a time; others queue.
- Restarting either service needs authorization — don't bounce it speculatively.
