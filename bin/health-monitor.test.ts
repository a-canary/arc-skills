#!/usr/bin/env bun
// Tests for health-monitor. The monitor is stateless: it probes every service
// each tick and calls alert(state, serviceId, detail) for each one. Dedupe is
// handled by notify's --dedupe-key, so tests assert raw alert calls.

import { describe, expect, test } from "bun:test";
import { get, runHealthMonitor, type Service } from "./health-monitor";

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