#!/usr/bin/env bun
// health-monitor — one cron tick that probes the estate's long-running
// surfaces and reports DOWN/UP transitions to Discord + director chat via
// arc-agents/bin/notify.ts.
//
// Design (where this shape):
//   - Drain-don't-spam: state is tracked by notify's `--dedupe-key` flag,
//     which only fires on transitions (down→up, up→down). Sustained outages
//     and sustained health stay silent; transitions alert once.
//   - One failing check never hides the others: every check is independent and
//     runs under its own timeout.
//   - Exit 0 always, even on outages. The cron ERR trap (cron-preamble) files a
//     report-error per failed tick; an outage is not a broken monitor.
//
// History: this script previously used the ledger's `feedback` table as both
// alerting surface AND state (drain-don't-spam). The bead director-vby moved
// alerting to Discord + director chat only; state moved into notify's dedupe
// sidecar at ~/vault/health/notify-state/<key>.json.
//
// Cron (every 5 min; PATH pinned — bare `bun` is not in cron's PATH):
//   */5 * * * * PATH=/home/aaron/.bun/bin:/usr/local/bin:/usr/bin:/bin $HOME/.bun/bin/bun $HOME/repos/arc-skills/bin/health-monitor.ts >> $HOME/.cache/arc-health-monitor.log 2>&1
//
// Manual:  bun bin/health-monitor.ts [--quiet] [--dry-run]
//   --dry-run  probe + print, write no alert/file.
//
// Env: VAULT_DIR, HEALTH_DIR, NOTIFY_BIN (default ~/repos/arc-agents/bin/notify.ts),
//      DISCORD_WEBHOOK_URL (default: `pass show discord/webhook-url`, read only when alerting)

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "";
const VAULT = process.env.VAULT_DIR ?? join(HOME, "vault");
const OUT_DIR = process.env.HEALTH_DIR ?? join(VAULT, "health");
const NOTIFY_BIN = process.env.NOTIFY_BIN ?? join(HOME, "repos", "arc-agents", "bin", "notify.ts");
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 4000);

export type Service = { id: string; project: string; probe: () => Promise<string> };

const fail = (msg: string): never => {
  throw new Error(msg);
};

// ---- native probe helpers -------------------------------------------------

// One retry on network error: a single reset/timeout (~2% of public probes)
// otherwise flips state and pages, since dedupe only suppresses repeats.
export async function get(url: string, init?: RequestInit, retries = 1): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return retries > 0 ? get(url, init, retries - 1) : null;
  }
}

/** First URL that answers 200 wins; throws with every attempt listed. */
async function firstOk(urls: string[]): Promise<string> {
  const tried: string[] = [];
  for (const u of urls) {
    const r = await get(u);
    if (r?.status === 200) return u;
    tried.push(`${u} → ${r ? r.status : "unreachable"}`);
  }
  return fail(`no healthy endpoint: ${tried.join(", ")}`);
}

function sh(cmd: string, args: string[]): { rc: number; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { rc: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Newest mtime (epoch ms) among `dirs`' files matching `re`, 0 if none. */
function newestLog(dirs: string[], re: RegExp): number {
  let newest = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!re.test(f)) continue;
      const { mtimeMs } = statSync(join(d, f));
      if (mtimeMs > newest) newest = mtimeMs;
    }
  }
  return newest;
}

/**
 * DISCORD_WEBHOOK_URL, else `pass show discord/webhook-url` exported into this
 * process's env, so the secret never sits in crontab (repos-bm5). "" when neither.
 */
export function discordWebhook(): string {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    const p = spawnSync("pass", ["show", "discord/webhook-url"], { encoding: "utf8", timeout: 10_000 });
    const url = p.status === 0 ? p.stdout.split("\n")[0].trim() : "";
    if (url) process.env.DISCORD_WEBHOOK_URL = url;
  }
  return process.env.DISCORD_WEBHOOK_URL ?? "";
}

/**
 * Alert via arc-agents/bin/notify.ts. Fan-out to Discord + director chat.
 * Passes --dedupe-key so notify only fires on state transitions; sustained
 * outages and sustained health stay silent.
 *
 * Never throws: a dead alert path must not hide the finding (already on stderr).
 */
export async function sendAlert(state: "down" | "up", serviceId: string, detail: string): Promise<boolean> {
  const emoji = state === "down" ? "🔴" : "🟢";
  const title = state === "down" ? `${serviceId} DOWN` : `${serviceId} recovered`;
  const body = `${emoji} **${title}** — ${detail}`;
  try {
    discordWebhook(); // notify.ts reads it from the inherited env
    const r = spawnSync(
      process.execPath,
      [NOTIFY_BIN, title, body, "--source", "health-monitor", "--severity", state === "down" ? "error" : "info", "--dedupe-key", `health-monitor:${serviceId}`, "--state", state],
      { encoding: "utf8", timeout: 15_000 },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

// ---- the services ---------------------------------------------------------

const QUIET = process.argv.includes("--quiet");

export const SERVICES: Service[] = [
  {
    id: "auto-llm",
    project: "llm-hosting",
    // The LLM router: 8090 is the historic bind, 8091 the current one.
    probe: async () => {
      const url = await firstOk(["http://localhost:8090/health", "http://127.0.0.1:8091/health"]);
      const body = (await (await get(url))!.json()) as { ok?: boolean };
      return body.ok === true ? `${url} ok` : fail(`${url} not ok: ${JSON.stringify(body)}`);
    },
  },
  {
    id: "v100",
    project: "llm-hosting",
    // GPU inference behind provider `v100`. The model runs on ai-lab-02; :8099 here is
    // lane-front, and /health passes front -> laneproxy -> llama-server (502 if any hop is down).
    // While the idle detector lends the GPU to a batch job llama is stopped by design; the next
    // POST reclaims it, so a lend reads as up.
    // ponytail: a failed reclaim leaves lent=true and reads up here; it surfaces as 502s on the
    // POST path, not in this probe. Add a reclaim-failure counter to /__lanes if that bites.
    probe: async () => {
      try {
        return `${await firstOk(["http://127.0.0.1:8099/health"])} ok`;
      } catch (e) {
        const lanes = (await (await get("http://127.0.0.1:8099/__lanes"))?.json().catch(() => null)) as { idle?: { lent?: boolean } } | null;
        if (lanes?.idle?.lent === true) return "GPU lent to batch job (reclaims on next request)";
        throw e;
      }
    },
  },
  {
    id: "webui",
    project: "arc-webui",
    probe: async () => `${await firstOk(["http://localhost:8080/"])} ok`,
  },
  {
    id: "discord",
    project: "arc-skills",
    // The alert path itself: a broken transport turns every other alert silent.
    probe: async () => {
      const url = discordWebhook();
      if (url) {
        const r = await get(url);
        return r?.status === 200 ? "webhook reachable" : fail(`webhook → ${r?.status ?? "unreachable"}`);
      }
      // No webhook set is a config gap, not an outage — surface as failure so
      // the operator sees it once per transition rather than on every tick.
      return fail("DISCORD_WEBHOOK_URL not set and no pass discord/webhook-url");
    },
  },
  {
    id: "trading",
    project: "trading",
    // ponytail: trading has no daemon — it is cron-driven (daily-cycle 13:00Z,
    // rebalance 13:45Z, both Mon-Fri), so "alive" == a log written recently.
    // 96h window spans a weekend plus a missed day without false-alarming.
    // Upgrade path: a per-stage heartbeat row once trading emits one.
    probe: async () => {
      const newest = newestLog(
        [join(HOME, "repos/trading/logs"), join(VAULT, "trading")],
        /\.log$/,
      );
      if (!newest) return fail("no trading logs found");
      const ageH = (Date.now() - newest) / 3_600_000;
      return ageH < 96
        ? `last trading log activity ${ageH.toFixed(1)}h ago`
        : fail(`no trading log activity for ${ageH.toFixed(1)}h (cron stalled?)`);
    },
  },
  {
    id: "ndivisible",
    project: "ndivisible",
    probe: async () => {
      const ps = sh("docker", ["ps", "--filter", "name=ndivisible-", "--format", "{{.Names}}"]);
      const up = ps.out.split("\n").filter(Boolean).sort();
      const missing = ["api", "web", "postgres"].filter((s) => !up.some((n) => n.includes(`ndivisible-${s}-`)));
      if (missing.length) return fail(`containers down: ${missing.join(", ")} (up: ${up.join(", ") || "none"})`);
      const pub = await get("https://app.ndivisible.com/api/health");
      return pub?.status === 200 ? `${up.join(", ")}; public 200` : fail(`public /api/health → ${pub?.status ?? "unreachable"}`);
    },
  },
];

// ---- the run --------------------------------------------------------------

export type Result = { id: string; project: string; ok: boolean; detail: string };

/**
 * Probe every service, then alert via notify.ts on transitions. Dedupe is
 * handled by notify's --dedupe-key, so this function stays stateless.
 *
 * `sendAlert` is injected so tests can spy on it without touching notify.
 */
export async function runHealthMonitor(opts: {
  services: Service[];
  alert: (state: "down" | "up", serviceId: string, detail: string) => Promise<unknown>;
  outDir?: string | null;
  quiet?: boolean;
  log?: (line: string) => void;
}): Promise<Result[]> {
  const { services, alert, outDir = OUT_DIR, quiet = QUIET, log = console.log } = opts;
  const results = await Promise.all(
    services.map(async ({ id, project, probe }) => {
      try {
        return { id, project, ok: true, detail: await probe() };
      } catch (e) {
        return { id, project, ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  for (const r of results) {
    // notify.ts dedupe handles the transition gating; we always call.
    await alert(r.ok ? "up" : "down", r.id, r.detail);
    if (!quiet) log(`${r.ok ? "ok  " : "DOWN"} ${r.id.padEnd(16)} ${r.detail}`);
  }

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString();
    const down = results.filter((r) => !r.ok);
    writeFileSync(
      join(outDir, "status.json"),
      `${JSON.stringify({ at: stamp, down: down.length, services: results }, null, 1)}\n`,
    );
    appendFileSync(
      join(outDir, "monitor.log"),
      `${stamp} ok=${results.length - down.length}/${results.length} down=[${down.map((d) => d.id).join(",")}]\n`,
    );
  }
  return results;
}

// ---- CLI ------------------------------------------------------------------

async function main() {
  const dry = process.argv.includes("--dry-run");
  try {
    const results = await runHealthMonitor({
      services: SERVICES,
      alert: dry
        ? async () => null
        : (state, id, detail) => sendAlert(state, id, detail),
      outDir: dry ? null : OUT_DIR,
    });
    const down = results.filter((r) => !r.ok).map((r) => r.id);
    console.log(`health-monitor: ${results.length - down.length}/${results.length} up${down.length ? ` — DOWN: ${down.join(", ")}` : ""}`);
  } catch (e) {
    console.error(`health-monitor: run failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();