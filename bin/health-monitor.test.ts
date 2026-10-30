#!/usr/bin/env bun
// Tests for health-monitor. The monitor is stateless: it probes every service
// each tick and calls alert(state, serviceId, detail) for each one. Dedupe is
// handled by notify's --dedupe-key, so tests assert raw alert calls.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, runHealthMonitor, type Service, siloBackupCheck } from "./health-monitor";

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
  w({ nd: { at: "2026-10-29T02:00:00Z", ok: true, msg: "12M" } });
  expect(() => siloBackupCheck(p, now)).toThrow(/nd stale/);
  w({ nd: { at: "2026-10-30T02:00:00Z", ok: false, msg: "upload failed" } });
  expect(() => siloBackupCheck(p, now)).toThrow(/upload failed/);
  w({});
  expect(() => siloBackupCheck(p, now)).toThrow(/no silos/);
  expect(() => siloBackupCheck(`${p}.missing`, now)).toThrow(/no silo-backup status/);
});
