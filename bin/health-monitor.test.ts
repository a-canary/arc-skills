#!/usr/bin/env bun
// Tests for health-monitor. The monitor is stateless: it probes every service
// each tick and calls alert(state, serviceId, detail) for each one. Dedupe is
// handled by notify's --dedupe-key, so tests assert raw alert calls.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyLend, Degraded, get, LEND_ESCALATE_MS, probeV100, readLendClaimedAt, runHealthMonitor, runningV100Job, type Service, siloBackupCheck } from "./health-monitor";

const svc = (id: string, ok: boolean, detail?: string): Service => ({
  id,
  project: "test",
  probe: async () => {
    if (!ok) throw new Error(detail ?? "unreachable");
    return detail ?? "fine";
  },
});

function run(services: Service[]) {
  const alerts: Array<{ state: "down" | "up"; id: string; detail: string }> = [];
  return runHealthMonitor({
    services,
    alert: async (state, id, detail) => alerts.push({ state, id, detail }),
    outDir: null,
    quiet: true,
    log: () => {},
  }).then((results) => ({ results, alerts }));
}

describe("health-monitor", () => {
  test("a failing probe alerts down with the error message once", async () => {
    const { alerts } = await run([svc("alpha", false, "port 1 refused")]);
    expect(alerts).toEqual([{ state: "down", id: "alpha", detail: "port 1 refused" }]);
  });

  test("a healthy probe alerts up with the probe detail", async () => {
    const { alerts } = await run([svc("alpha", true, "back at :9999")]);
    expect(alerts).toEqual([{ state: "up", id: "alpha", detail: "back at :9999" }]);
  });

  test("one failing check never hides the others", async () => {
    const { results, alerts } = await run([
      svc("a", false, "boom"),
      svc("b", true),
      svc("c", true),
    ]);
    expect(results.length).toBe(3);
    expect(results.map((r) => r.ok)).toEqual([false, true, true]);
    expect(alerts.length).toBe(3);
    expect(alerts.find((a) => a.id === "a")?.state).toBe("down");
    expect(alerts.find((a) => a.id === "b")?.state).toBe("up");
    expect(alerts.find((a) => a.id === "c")?.state).toBe("up");
  });
});

test("get retries once on a transient network error", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    if (++calls === 1) throw new Error("ECONNRESET");
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    expect((await get("http://x"))?.status).toBe(200);
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = real;
  }
});
test("sendAlert hands a webhook resolved after start-up to the notify child (repos-bm5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-env-"));
  const stub = join(dir, "notify-stub.ts");
  const out = join(dir, "seen");
  writeFileSync(stub, `require("node:fs").writeFileSync(${JSON.stringify(out)}, process.env.DISCORD_WEBHOOK_URL ?? "UNSET");`);
  // child process: start WITHOUT the var, set it at runtime (as discordWebhook() does from pass), then alert
  const env = { ...process.env, NOTIFY_BIN: stub };
  delete env.DISCORD_WEBHOOK_URL;
  const code = `process.env.DISCORD_WEBHOOK_URL = "stub-url"; const m = await import(${JSON.stringify(join(import.meta.dir, "health-monitor.ts"))}); console.log(await m.sendAlert("down", "x", "d"));`;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env, timeout: 30_000 });
  expect(r.stdout.trim()).toBe("true");
  expect(readFileSync(out, "utf8")).toBe("stub-url");
});

test("siloBackupCheck: fresh ok passes; stale, failed, missing, empty fail", () => {
  const p = join(mkdtempSync(join(tmpdir(), "silo-")), "status.json");
  const now = Date.parse("2026-10-30T12:00:00Z"), w = (o: object) => writeFileSync(p, JSON.stringify(o));
  w({ nd: { at: "2026-10-30T02:00:00Z", ok: true, msg: "12M" } });
  expect(siloBackupCheck(p, now)).toBe("1 silo(s) fresh");
  w({ nd: { at: "2026-10-29T11:00:00Z", ok: true, msg: "12M" } }); // 25h: inside the 26h window
  expect(siloBackupCheck(p, now)).toBe("1 silo(s) fresh");
  w({ nd: { at: "2026-10-29T09:00:00Z", ok: true, msg: "12M" } }); // 27h
  expect(() => siloBackupCheck(p, now)).toThrow(/nd stale/);
  w({ nd: { at: "garbage", ok: true, msg: "12M" } });
  expect(() => siloBackupCheck(p, now)).toThrow(/nd stale/);
  w({ nd: { at: "2026-10-30T02:00:00Z", ok: false, msg: "upload failed" } });
  expect(() => siloBackupCheck(p, now)).toThrow(/upload failed/);
  w({});
  expect(() => siloBackupCheck(p, now)).toThrow(/no silos/);
  expect(() => siloBackupCheck(`${p}.missing`, now)).toThrow(/no silo-backup status/);
});

// ---- repos-pkql: a lent GPU must never read as OK --------------------------

const lendSvc = (): Service => ({
  id: "v100",
  project: "test",
  probe: async () => {
    throw new Degraded("lent claimed, no running v100 job (1m; DOWN after 15m)");
  },
});

describe("degraded status (repos-pkql)", () => {
  test("a Degraded probe alerts as degraded, never as up or down", async () => {
    const { results, alerts } = await run([lendSvc()]);
    expect(alerts).toEqual([
      { state: "degraded", id: "v100", detail: "lent claimed, no running v100 job (1m; DOWN after 15m)" },
    ]);
    expect(results[0]?.status).toBe("degraded");
    expect(results[0]?.ok).toBe(false);
  });

  test("status.json and monitor.log count degraded separately from down", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hm-out-"));
    await runHealthMonitor({
      services: [lendSvc(), svc("b", false, "boom"), svc("c", true)],
      alert: async () => {},
      outDir: dir,
      quiet: true,
      log: () => {},
    });
    const st = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    expect(st.degraded).toBe(1);
    expect(st.down).toBe(1);
    const line = readFileSync(join(dir, "monitor.log"), "utf8").trim().split("\n").pop() ?? "";
    expect(line).toContain("ok=1/3");
    expect(line).toContain("degraded=[v100]");
    expect(line).toContain("down=[b]");
  });
});

describe("classifyLend", () => {
  const now = Date.parse("2026-11-19T05:00:00Z");

  test("a running job claim is degraded, named, and does not start the no-job clock", () => {
    const v = classifyLend({ jobId: "slm-r4q-smoke", now, claimedAt: now - 60 * 60_000 });
    expect(v.verdict).toBe("degraded");
    expect(v.detail).toContain("slm-r4q-smoke");
    expect(v.claimedAt).toBeNull();
  });

  test("no job yet is degraded and starts the clock", () => {
    const v = classifyLend({ jobId: null, now, claimedAt: null });
    expect(v.verdict).toBe("degraded");
    expect(v.claimedAt).toBe(now);
  });

  test("no job for 14 min is still degraded; 15 min is DOWN", () => {
    expect(classifyLend({ jobId: null, now, claimedAt: now - 14 * 60_000 }).verdict).toBe("degraded");
    const down = classifyLend({ jobId: null, now, claimedAt: now - LEND_ESCALATE_MS });
    expect(down.verdict).toBe("down");
    expect(down.detail).toContain("15m");
  });

  test("no input ever yields OK: that was the bug (a dead llama read healthy)", () => {
    const verdicts = [
      classifyLend({ jobId: "job", now, claimedAt: null }),
      classifyLend({ jobId: null, now, claimedAt: null }),
      classifyLend({ jobId: null, now, claimedAt: now - 60 * 60_000 }),
    ].map((v) => v.verdict);
    expect(verdicts).toEqual(["degraded", "degraded", "down"]);
    expect(verdicts).not.toContain("ok" as never);
  });
});

test("runningV100Job: a started job counts, queued/finished/garbage do not", () => {
  const dir = mkdtempSync(join(tmpdir(), "jobs-v100-"));
  expect(runningV100Job(dir)).toBeNull(); // empty
  writeFileSync(join(dir, "a-queued.json"), JSON.stringify({ state: "queue" }));
  writeFileSync(join(dir, "b-done.json"), JSON.stringify({ state: "done" }));
  writeFileSync(join(dir, "c-bad.json"), "{not json");
  expect(runningV100Job(dir)).toBeNull();
  writeFileSync(join(dir, "d-running.json"), JSON.stringify({ state: "started" }));
  expect(runningV100Job(dir)).toBe("d-running");
  expect(runningV100Job(join(dir, "missing"))).toBeNull();
});

test("readLendClaimedAt: number round-trip, garbage and null are 'no clock'", () => {
  const p = join(mkdtempSync(join(tmpdir(), "lend-")), "s.json");
  expect(readLendClaimedAt(p)).toBeNull(); // missing
  writeFileSync(p, JSON.stringify({ claimedAt: 123 }));
  expect(readLendClaimedAt(p)).toBe(123);
  writeFileSync(p, JSON.stringify({ claimedAt: null }));
  expect(readLendClaimedAt(p)).toBeNull();
  writeFileSync(p, "garbage");
  expect(readLendClaimedAt(p)).toBeNull();
});

// The probe itself, against a real HTTP front: the original bug lived in these
// lines and nothing automated ever executed them (repos-pkql).
test("probeV100: a dead llama behind a 'lent' front is never OK", async () => {
  let health = 502;
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/__lanes") return Response.json({ slots: [], idle: { lent: true } });
      return new Response("llama is dead", { status: health });
    },
  });
  const front = `http://127.0.0.1:${srv.port}`;
  const claimPath = join(mkdtempSync(join(tmpdir(), "claim-")), "lend.json");
  const t0 = 1_000_000;
  const err = async (o: Parameters<typeof probeV100>[0]) => probeV100(o).then(() => null, (e: Error) => e);
  try {
    // lent, no job: degraded (and the clock starts)
    const first = await err({ front, now: t0, jobId: null, claimPath });
    expect(first?.name).toBe("Degraded");
    expect(first?.message).toContain("no running v100 job");
    expect(readLendClaimedAt(claimPath)).toBe(t0);

    // lent, a job claims to be running: still degraded, and it is named
    const named = await err({ front, now: t0 + 60_000, jobId: "slm-x", claimPath });
    expect(named?.name).toBe("Degraded");
    expect(named?.message).toContain("slm-x");
    expect(readLendClaimedAt(claimPath)).toBeNull(); // clock cleared: a job resets it

    // lent, no job, clock past 15m: DOWN (plain Error, not Degraded).
    // Two cron ticks, as the monitor actually sees it: the first starts the clock.
    const claim2 = join(mkdtempSync(join(tmpdir(), "claim2-")), "lend.json");
    expect((await err({ front, now: t0, jobId: null, claimPath: claim2 }))?.name).toBe("Degraded");
    const down = await err({ front, now: t0 + 16 * 60_000, jobId: null, claimPath: claim2 });
    expect(down?.name).not.toBe("Degraded");
    expect(down?.message).toContain("lent for 16m with no running v100 job");

    // llama answers: ok, and the clock is cleared so the next lend starts fresh
    health = 200;
    await expect(probeV100({ front, now: t0, jobId: null, claimPath })).resolves.toContain("ok");
    expect(readLendClaimedAt(claimPath)).toBeNull();
  } finally {
    srv.stop(true);
  }
});

test("probeV100: no idle object, or lent=false, is DOWN — nothing excuses a stopped llama", async () => {
  let lanes: unknown = { slots: [] };
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/__lanes") return Response.json(lanes);
      return new Response("down", { status: 502 });
    },
  });
  const front = `http://127.0.0.1:${srv.port}`;
  const claimPath = join(mkdtempSync(join(tmpdir(), "claim-")), "lend.json");
  const err = async () => probeV100({ front, now: 1, jobId: null, claimPath }).then(() => null, (e: Error) => e);
  try {
    expect((await err())?.message).toContain("no lend claim");
    lanes = { idle: { lent: false } };
    expect((await err())?.message).toContain("idle.lent=false");
    // an unreadable body is no evidence either — it must not become an excuse
    lanes = "not json at all";
    expect((await err())?.message).toContain("no lend claim");
    expect(readLendClaimedAt(claimPath)).toBeNull();
  } finally {
    srv.stop(true);
  }
});

test("probeV100: jobId omitted reads rd-director state (the live path, not a stub)", async () => {
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/__lanes") return Response.json({ idle: { lent: true } });
      return new Response("dead", { status: 502 });
    },
  });
  const front = `http://127.0.0.1:${srv.port}`;
  const jobsDir = mkdtempSync(join(tmpdir(), "jobs-live-"));
  const claimPath = join(mkdtempSync(join(tmpdir(), "claim-")), "lend.json");
  const err = async () => probeV100({ front, now: 5, jobsDir, claimPath }).then(() => null, (e: Error) => e);
  try {
    writeFileSync(join(jobsDir, "slm-live.json"), JSON.stringify({ state: "started" }));
    const e1 = await err();
    expect(e1?.name).toBe("Degraded");
    expect(e1?.message).toContain("slm-live"); // the real lookup ran and named the job
  } finally {
    srv.stop(true);
  }
});
