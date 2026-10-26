// LLM call via `claude -p` (Max seat) with harness context stripped (~550 tok overhead/call).
// ponytail: one provider; swap `call` body for an HTTP client when an API key is live.

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

export async function call(model: string, system: string, user: string): Promise<Call> {
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
