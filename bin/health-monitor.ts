#!/usr/bin/env bun
// health-monitor — one cron tick that probes the estate's long-running
// surfaces and reports DOWN/UP transitions to Discord + director chat via
// bin/notify.ts.
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
// Env: VAULT_DIR, HEALTH_DIR, NOTIFY_BIN (default: bin/notify.ts beside this file),
//      DISCORD_WEBHOOK_URL (default: `pass show discord/webhook-url`, read by the discord probe / first alert)

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HOME = process.env.HOME ?? "";
const VAULT = process.env.VAULT_DIR ?? join(HOME, "vault");
const OUT_DIR = process.env.HEALTH_DIR ?? join(VAULT, "health");
const NOTIFY_BIN = process.env.NOTIFY_BIN ?? join(import.meta.dir, "notify.ts");
const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 4000);

export type Service = { id: string; project: string; probe: () => Promise<string> };

const fail = (msg: string): never => {
  throw new Error(msg);
};

/**
 * A status that is neither healthy nor down: the surface is unusable, but the
 * cause is explainable and may be legitimate (llama stopped for a GPU lend).
 * It must never read as OK — that is how a dead llama stayed green (repos-pkql)
 * — and it must not page as DOWN either, because a real lend can last hours.
 * Dedupe treats it as its own state, so degraded→recovered and
 * degraded→down each alert once.
 */
export class Degraded extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "Degraded";
  }
}
const degraded = (msg: string): never => {
  throw new Degraded(msg);
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

const webuiAuth = (): RequestInit | undefined => {
  try { return { headers: { Authorization: `Bearer ${readFileSync(join(process.env.HOME ?? "", ".config/arc-webui/token"), "utf8").trim()}` } }; } catch { return undefined; }
};

export function siloBackupCheck(path: string, now = Date.now()): string {
  let st: Record<string, { at: string; ok: boolean; msg: string }>;
  try { st = JSON.parse(readFileSync(path, "utf8")); } catch { return fail(`no silo-backup status at ${path}`); }
  const silos = Object.entries(st);
  if (!silos.length) return fail("silo-backup status has no silos");
  const bad = silos.filter(([, v]) => !v.ok || now - Date.parse(v.at) > 26 * 3600_000 || Number.isNaN(Date.parse(v.at)));
  return bad.length ? fail(`silo-backup: ${bad.map(([k, v]) => `${k} ${v.ok ? "stale" : v.msg} @${v.at}`).join("; ")}`) : `${silos.length} silo(s) fresh`;
}

/** First URL that answers 200 wins; throws with every attempt listed. */
async function firstOk(urls: string[], init?: RequestInit): Promise<string> {
  const tried: string[] = [];
  for (const u of urls) {
    const r = await get(u, init);
    if (r?.status === 200) return u;
    tried.push(`${u} → ${r ? r.status : "unreachable"}`);
  }
  return fail(`no healthy endpoint: ${tried.join(", ")}`);
}

// ---- lend classification (repos-pkql) -------------------------------------

/**
 * GET + JSON parse, or null. A monitor probe must never throw on a malformed
 * body: an unparseable /__lanes is "no evidence", not a new failure mode.
 */
async function getJson(url: string): Promise<unknown | null> {
  const r = await get(url);
  if (!r || r.status !== 200) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * A v100 batch job that claims to be running, or null. This is deliberately
 * weak evidence — rd-director's job state is known to go stale (repos-gxiy:
 * four jobs still said `queue` after they finished) — so a hit here yields
 * DEGRADED, never OK, and a miss only means "not proven running".
 */
export function runningV100Job(
  dir = join(HOME, "repos/rd-director/jobs/local-v100"),
): string | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of names) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { state?: unknown };
      if (["started", "running", "run"].includes(String(d?.state))) return f.replace(/\.json$/, "");
    } catch {
      continue; // unreadable spec is not a running job
    }
  }
  return null;
}

/** How long "lent with no job" may hold before it is a DOWN, not a degraded. */
export const LEND_ESCALATE_MS = 15 * 60_000;

/**
 * Classify a `lent` claim from laneproxy. Pure: the caller supplies the job
 * evidence, the clock and the persisted first-seen time.
 *
 * Why this exists: laneproxy's idle_cmd contract is "exit 1 = no job, upstream
 * running; anything else = assume lent", so an error or a timeout is
 * indistinguishable from a real lend (laneproxy.py:1072). Reporting that state
 * as health let a dead llama read green (repos-pkql).
 */
export function classifyLend(opts: {
  jobId: string | null;
  now: number;
  claimedAt: number | null;
  escalateMs?: number;
}): { verdict: "degraded" | "down"; detail: string; claimedAt: number | null } {
  const { jobId, now, claimedAt, escalateMs = LEND_ESCALATE_MS } = opts;
  if (jobId) {
    return {
      verdict: "degraded",
      detail: `lent to batch job ${jobId}: llama stopped for it, and the job claim is rd-director's job state (not the GPU) — degraded, not healthy`,
      claimedAt: null,
    };
  }
  const since = claimedAt ?? now;
  const mins = Math.round((now - since) / 60_000);
  if (now - since >= escalateMs) {
    return {
      verdict: "down",
      detail: `lent for ${mins}m with no running v100 job — laneproxy assumes lent on any idle_cmd error/timeout, so a crashed hook looks like this and llama stays stopped`,
      claimedAt: since,
    };
  }
  return {
    verdict: "degraded",
    detail: `lent claimed, no running v100 job (${mins}m; DOWN after ${Math.round(escalateMs / 60_000)}m)`,
    claimedAt: since,
  };
}

/** Persisted first-seen time for "lent with no job" so the 15-min clock spans cron ticks. */
const lendClaimPath = () => join(OUT_DIR, "lend-unverified.json");

export function readLendClaimedAt(path = lendClaimPath()): number | null {
  try {
    const v = (JSON.parse(readFileSync(path, "utf8")) as { claimedAt?: unknown }).claimedAt;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function writeLendClaimedAt(claimedAt: number | null, path = lendClaimPath()): void {
  try {
    if (claimedAt === null) {
      if (existsSync(path)) writeFileSync(path, `${JSON.stringify({ claimedAt: null })}\n`);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ claimedAt })}\n`);
  } catch {
    // state is a nicety: losing it delays a DOWN by one tick, it must not throw
  }
}

/**
 * The v100 probe. Extracted from SERVICES so the regression has an automated
 * test against a real HTTP front — the inline version could only be checked by
 * hand, which is how the original bug survived in plain sight.
 *
 * Every input is injectable (front URL, clock, job lookup, clock file); the
 * defaults are the live ones.
 */
export async function probeV100(
  opts: {
    front?: string;
    now?: number;
    jobId?: string | null; // undefined = ask rd-director; null = proven no job
    jobsDir?: string;
    claimPath?: string;
    escalateMs?: number;
  } = {},
): Promise<string> {
  const { front = "http://127.0.0.1:8099", now = Date.now(), claimPath = lendClaimPath(), escalateMs } = opts;
  let up: string;
  try {
    up = `${await firstOk([`${front}/health`])} ok`;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const lanes = (await getJson(`${front}/__lanes`)) as { idle?: { lent?: boolean } } | null;
    const idle = lanes?.idle;
    // No `idle` object = the lend feature is off in this deployment (or the
    // snapshot is unreadable): nothing here may excuse a stopped llama.
    if (!idle) return fail(`${front} health down (${why}); no lend claim — idle absent or /__lanes unreadable`);
    if (idle.lent !== true) return fail(`${front} health down (${why}); idle.lent=false — llama stopped, not lent`);
    const v = classifyLend({
      jobId: opts.jobId === undefined ? runningV100Job(opts.jobsDir) : opts.jobId,
      now,
      claimedAt: readLendClaimedAt(claimPath),
      escalateMs,
    });
    writeLendClaimedAt(v.claimedAt, claimPath);
    return v.verdict === "down" ? fail(v.detail) : degraded(v.detail);
  }
  writeLendClaimedAt(null, claimPath); // healthy: the next lend starts a fresh no-job clock
  return up;
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
 * Alert via bin/notify.ts. Fan-out to Discord + director chat.
 * Passes --dedupe-key so notify only fires on state transitions; sustained
 * outages and sustained health stay silent.
 *
 * Never throws: a dead alert path must not hide the finding (already on stderr).
 */
export async function sendAlert(state: "down" | "up" | "degraded", serviceId: string, detail: string): Promise<boolean> {
  const emoji = state === "down" ? "🔴" : state === "degraded" ? "🟡" : "🟢";
  const title = state === "down" ? `${serviceId} DOWN` : state === "degraded" ? `${serviceId} DEGRADED` : `${serviceId} recovered`;
  const severity = state === "down" ? "error" : state === "degraded" ? "warn" : "info";
  const body = `${emoji} **${title}** — ${detail}`;
  try {
    discordWebhook();
    const r = spawnSync(
      process.execPath,
      [NOTIFY_BIN, title, body, "--source", "health-monitor", "--severity", severity, "--dedupe-key", `health-monitor:${serviceId}`, "--state", state],
      // explicit env: Bun's spawnSync passes the START-UP env, not later process.env writes
      { encoding: "utf8", timeout: 15_000, env: process.env },
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
    id: "v100",
    project: "llm-hosting",
    // GPU inference behind provider `v100`. The model runs on ai-lab-02; :8099 here is
    // lane-front, and /health passes front -> laneproxy -> llama-server (502 if any hop is down).
    // While the idle detector lends the GPU to a batch job llama is stopped by design, so a
    // lend must not read as DOWN — but it must not read as OK either: laneproxy sets `lent`
    // for ANY idle_cmd exit that is not 1, so a crashed hook, a timeout and a real lend are
    // indistinguishable (laneproxy.py:1072). A dead llama read green here for three days
    // (repos-pkql, 8reo: 18 start/stops). Classification lives in classifyLend:
    //   job claim present -> DEGRADED (named, never green, never pages)
    //   no job for 15 min -> DOWN (a crashed hook reads exactly like this)
    probe: () => probeV100(),
  },
  {
    id: "webui",
    project: "arc-webui",
    // webui binds the tailscale IP only and gates every route, so probe there with the bearer token.
    probe: async () => `${await firstOk(["http://100.91.151.13:8080/healthz", "http://localhost:8080/healthz"], webuiAuth())} ok`,
  },
  {
    id: "silo-backup",
    project: "estate",
    // bin/silo-backup.sh (nightly) writes per-silo status; stale >26h or a failed silo = DOWN.
    probe: async () => siloBackupCheck(join(process.env.HOME ?? "", ".cache/silo-backup/status.json")),
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

export type Status = "ok" | "degraded" | "down";
export type Result = { id: string; project: string; ok: boolean; status: Status; detail: string };

/**
 * Probe every service, then alert via notify.ts on transitions. Dedupe is
 * handled by notify's --dedupe-key, so this function stays stateless.
 *
 * Three states, because "the endpoint is down" and "the endpoint is off on
 * purpose and we cannot prove it" are different facts and only one is an
 * outage: a `Degraded` throw alerts as degraded (yellow) and never as OK.
 *
 * `sendAlert` is injected so tests can spy on it without touching notify.
 */
export async function runHealthMonitor(opts: {
  services: Service[];
  alert: (state: "down" | "up" | "degraded", serviceId: string, detail: string) => Promise<unknown>;
  outDir?: string | null;
  quiet?: boolean;
  log?: (line: string) => void;
}): Promise<Result[]> {
  const { services, alert, outDir = OUT_DIR, quiet = QUIET, log = console.log } = opts;
  const results = await Promise.all(
    services.map(async ({ id, project, probe }): Promise<Result> => {
      try {
        return { id, project, ok: true, status: "ok", detail: await probe() };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        // name, not instanceof: a reloaded module must not change the status
        const status: Status = (e as { name?: string })?.name === "Degraded" ? "degraded" : "down";
        return { id, project, ok: status === "ok", status, detail };
      }
    }),
  );

  for (const r of results) {
    // notify.ts dedupe handles the transition gating; we always call.
    await alert(r.status === "ok" ? "up" : r.status, r.id, r.detail);
    if (!quiet) log(`${r.status === "ok" ? "ok  " : r.status === "degraded" ? "WARN" : "DOWN"} ${r.id.padEnd(16)} ${r.detail}`);
  }

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString();
    const down = results.filter((r) => r.status === "down");
    const deg = results.filter((r) => r.status === "degraded");
    writeFileSync(
      join(outDir, "status.json"),
      `${JSON.stringify({ at: stamp, down: down.length, degraded: deg.length, services: results }, null, 1)}\n`,
    );
    appendFileSync(
      join(outDir, "monitor.log"),
      `${stamp} ok=${results.filter((r) => r.status === "ok").length}/${results.length} degraded=[${deg.map((d) => d.id).join(",")}] down=[${down.map((d) => d.id).join(",")}]\n`,
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
    const down = results.filter((r) => r.status === "down").map((r) => r.id);
    const deg = results.filter((r) => r.status === "degraded").map((r) => r.id);
    const ok = results.length - down.length - deg.length;
    console.log(
      `health-monitor: ${ok}/${results.length} up${deg.length ? ` — DEGRADED: ${deg.join(", ")}` : ""}${down.length ? ` — DOWN: ${down.join(", ")}` : ""}`,
    );
  } catch (e) {
    console.error(`health-monitor: run failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();