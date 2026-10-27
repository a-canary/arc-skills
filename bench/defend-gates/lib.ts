// LLM call via `claude -p` (Max seat) with harness context stripped (~550 tok overhead/call).
// ponytail: one provider; swap `call` body for an HTTP client when an API key is live.

import { readdirSync, readFileSync, existsSync } from "fs";

// Corpus + adjudicated key amendments (corpus-amend/<id>.json: unkeyed defects that two independent adjudicators confirmed on a
// "clean" control, see adjudicate.ts). originalVerdict keeps the authoring key for the grey raw-key column.
export const isDefectLabel = (l: string) => /^[dx]\d+$/.test(l);
export function loadCorpus(dir: string): Record<string, any> {
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  return Object.fromEntries(readdirSync(`${dir}/corpus`).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const k = read(`${dir}/corpus/${f}`), am = `${dir}/corpus-amend/${f}`;
    k.originalVerdict = k.expected_verdict;
    if (existsSync(am)) { k.expected_verdict = "ATTACKS"; k.defects = [...k.defects, ...read(am).defects]; k.amended = true; }
    return [k.id, k];
  }));
}

export type Usage = { calls: number; tokIn: number; tokOut: number; usd: number; critMs: number };
export type Call = { text: string; tokIn: number; tokOut: number; usd: number; ms: number };

export const zero = (): Usage => ({ calls: 0, tokIn: 0, tokOut: 0, usd: 0, critMs: 0 });

const CWD = "/tmp/defend-bench";

// Global concurrency cap shared by every call (claude seat rate limits).
let active = 0;
const waiters: (() => void)[] = [];
export let MAX_CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 8);
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// OpenAI-compatible backends, addressed as "<prefix>:<model>". v100 = sovereign local qwen on ai-lab-02 (single lane).
// usd=0: local/9router spend is not list-priced; compare these on tokens and latency.
const HTTP: Record<string, { base: string; lanes: number; key?: string }> = {
  v100: { base: "http://127.0.0.1:8099", lanes: 1 },
  "9r": { base: "http://127.0.0.1:20128", lanes: 4, key: "NINEROUTER_KEY" }, // key: env var NAME (pass api/9router/local-key)
};
const httpActive: Record<string, number> = {}, httpWait: Record<string, (() => void)[]> = {};
async function httpCall(prefix: string, model: string, system: string, user: string): Promise<Call> {
  const ep = HTTP[prefix];
  while ((httpActive[prefix] ?? 0) >= ep.lanes) await new Promise<void>((r) => (httpWait[prefix] ??= []).push(r));
  httpActive[prefix] = (httpActive[prefix] ?? 0) + 1;
  const t0 = Date.now();
  try {
    const res = await fetch(`${ep.base}/v1/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(900_000),
      headers: { "content-type": "application/json", "user-agent": "defend-bench/1", ...(ep.key ? { authorization: `Bearer ${process.env[ep.key]}` } : {}) },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.7, max_tokens: 8192, chat_template_kwargs: { enable_thinking: false } }),
    });
    const j: any = await res.json().catch(() => ({}));
    const text = j.choices?.[0]?.message?.content;
    // An empty 200 is an infra fault, never a verdict.
    if (!res.ok || !text) throw new Error(`http ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return { text, tokIn: j.usage?.prompt_tokens ?? 0, tokOut: j.usage?.completion_tokens ?? 0, usd: 0, ms: Date.now() - t0 };
  } finally {
    httpActive[prefix]--;
    httpWait[prefix]?.shift()?.();
  }
}

export async function call(model: string, system: string, user: string): Promise<Call> {
  const [prefix, rest] = model.includes(":") ? [model.slice(0, model.indexOf(":")), model.slice(model.indexOf(":") + 1)] : ["", model];
  if (HTTP[prefix]) {
    let err = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await httpCall(prefix, rest, system, user); } catch (e) { err = String(e).slice(0, 300); await Bun.sleep(5000 * attempt); }
    }
    throw new Error(`infra: ${prefix} failed 3x: ${err}`);
  }
  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await slot(async () => {
      const p = Bun.spawn(
        ["claude", "-p", "--model", model, "--output-format", "json", "--system-prompt", system,
          "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
          "--exclude-dynamic-system-prompt-sections", "--no-session-persistence"],
        { cwd: CWD, stdin: new Blob([user]), stdout: "pipe", stderr: "pipe" },
      );
      const out = await new Response(p.stdout).text();
      await p.exited;
      return out;
    });
    try {
      const j = JSON.parse(r);
      if (j.is_error || j.terminal_reason !== "completed") throw new Error(`${j.terminal_reason}: ${String(j.result).slice(0, 200)}`);
      const u = j.usage;
      return {
        text: j.result,
        tokIn: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
        tokOut: u.output_tokens,
        usd: j.total_cost_usd,
        ms: j.duration_api_ms ?? j.duration_ms,
      };
    } catch (e) {
      lastErr = String(e).slice(0, 300) + " | raw=" + r.slice(0, 200);
      await Bun.sleep(5000 * attempt);
    }
  }
  throw new Error(`infra: claude -p failed 4x: ${lastErr}`);
}

// Extract the first JSON object from model text (tolerates fences/prose).
export function parseJson<T = any>(text: string): T {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("no JSON object in output: " + text.slice(0, 200));
  return JSON.parse(text.slice(s, e + 1));
}

// A call that must return JSON: reparse failures count as a retry (the tokens still count).
export async function callJson<T = any>(u: Usage, model: string, system: string, user: string): Promise<{ data: T; c: Call }> {
  let ms = 0;
  for (let attempt = 1; ; attempt++) {
    const c = await call(model, system, user);
    add(u, c);
    ms += c.ms;
    try {
      return { data: parseJson<T>(c.text), c: { ...c, ms } };
    } catch (e) {
      if (attempt >= 2) throw new Error("infra: unparseable JSON twice: " + String(e).slice(0, 200));
    }
  }
}

export function add(u: Usage, c: Call) {
  u.calls++;
  u.tokIn += c.tokIn;
  u.tokOut += c.tokOut;
  u.usd += c.usd;
}

// Run a stage of parallel calls; critical path grows by the slowest member.
export async function stage<T>(u: Usage, fns: (() => Promise<{ data: T; c: Call }>)[]): Promise<T[]> {
  const rs = await Promise.all(fns.map((f) => f()));
  u.critMs += Math.max(0, ...rs.map((r) => r.c.ms));
  return rs.map((r) => r.data);
}

export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}
