// capacity.test.ts — unit gates for the capacity skill (bun test).
// A3 port-parity gate: estimator must recover >=90% of hidden cap on the
// seed-42 reference traffic for BOTH provider truths (reference: 93% / 95%).

import { describe, expect, test } from "bun:test";
import { estimate, withMeter, type Outcome } from "./estimator.ts";
import { meterOf } from "./claude-window.ts";
import { arbitrate } from "./arbitrate.ts";

const lcg = (s: number) => () => (s = (s * 48271) % 2147483647) / 2147483647;
const T0 = 1_750_000_000;
const H = 3600;

function gen(truth: { name: string; W: number; C: number; weekly: number }, days = 14): Outcome[] {
  const rnd = lcg(42);
  let win = truth.C, wk = truth.weekly;
  const rows: Outcome[] = [];
  for (let h = 0; h < days * 24; h++) {
    if (h % truth.W === 0) win = truth.C;
    if (h % (7 * 24) === 0) wk = truth.weekly;
    const burst = (h % 24 >= 8 && h % 24 < 22 ? 1.4 : 0.2) * (0.5 + rnd());
    let demand = Math.floor(900_000 * burst);
    let i = 0;
    while (demand > 0) {
      const req = Math.min(150_000, demand);
      demand -= req;
      const ts = T0 + h * H + i++ * 60;
      if (win >= req && wk >= req) {
        win -= req; wk -= req;
        rows.push({ ts, provider: truth.name, tokens: req, status: "ok" });
      } else {
        rows.push({ ts, provider: truth.name, tokens: 0, status: "429" });
        break;
      }
    }
  }
  return rows;
}

describe("estimator port parity (seed-42 reference)", () => {
  for (const t of [
    { name: "claude-max-like", W: 5, C: 2_500_000, weekly: 80_000_000 },
    { name: "minimax-like", W: 5, C: 5_000_000, weekly: 100_000_000 },
  ]) {
    test(`${t.name}: cap recovery >=90%, window within 1h`, () => {
      const est = estimate(gen(t), t.name);
      expect(est.known).toBe(true);
      expect((est.capLB ?? 0) / t.C).toBeGreaterThanOrEqual(0.9);
      expect(Math.abs((est.windowHours ?? 999) - t.W)).toBeLessThanOrEqual(1);
    });
  }
});

describe("estimator edges", () => {
  test("no rows → unknown, not blocked", () => {
    const est = estimate([], "ghost");
    expect(est.known).toBe(false);
    expect(est.blocked).toBe(false);
    expect(est.headroomFrac).toBeNull();
  });
  test("only successes → unknown/green", () => {
    const rows: Outcome[] = [{ ts: T0, provider: "p", tokens: 100, status: "ok" }];
    expect(estimate(rows, "p").known).toBe(false);
  });
});

describe("arbitrate lanes", () => {
  const blocked = { ...estimate([], "p"), blocked: true, known: true };
  test("critical never parks — escalates when blocked", () => {
    expect(arbitrate(blocked, "critical").action).toBe("escalate");
  });
  test("research parks when blocked; vast_stop only >=30min parked", () => {
    expect(arbitrate(blocked, "research").action).toBe("park");
    expect(arbitrate(blocked, "research", { parkedMinutes: 29 }).vast_stop).toBe(false);
    expect(arbitrate(blocked, "research", { parkedMinutes: 30 }).vast_stop).toBe(true);
  });
  test("standard parks when blocked, no vast_stop", () => {
    const v = arbitrate(blocked, "standard", { parkedMinutes: 60 });
    expect(v.action).toBe("park");
    expect(v.vast_stop).toBe(false);
  });
  test("unknown provider → run", () => {
    expect(arbitrate(estimate([], "p"), "research").action).toBe("run");
  });
  test("featherless ctx>32k parks regardless of headroom", () => {
    expect(arbitrate(estimate([], "featherless"), "critical", { ctx: 64_000 }).action).toBe("park");
    expect(arbitrate(estimate([], "featherless"), "critical", { ctx: 8_000 }).action).toBe("run");
  });
});

describe("CLI fail-open red line", () => {
  const cli = new URL("./capacity.ts", import.meta.url).pathname;
  test("broken DB path → {action:run, fail_open:true}, exit 0", () => {
    const p = Bun.spawnSync(["bun", cli, "route", "--provider", "x", "--lane", "critical"], {
      env: { ...process.env, CAPACITY_DB: "/dev/null/nope/x.db" },
    });
    expect(p.exitCode).toBe(0);
    const v = JSON.parse(p.stdout.toString().trim());
    expect(v.action).toBe("run");
    expect(v.fail_open).toBe(true);
  });
  test("record + route roundtrip on tmp db", () => {
    const db = `/tmp/capacity-test-${process.pid}.db`;
    const env = { ...process.env, CAPACITY_DB: db };
    const rec = Bun.spawnSync(["bun", cli, "record", "--provider", "p", "--tokens", "1000", "--status", "ok"], { env });
    expect(JSON.parse(rec.stdout.toString().trim()).ok).toBe(true);
    const route = Bun.spawnSync(["bun", cli, "route", "--provider", "p", "--lane", "critical"], { env });
    const v = JSON.parse(route.stdout.toString().trim());
    expect(v.action).toBe("run");
    expect(v.fail_open).toBe(false);
  });
});

describe("vendor meter (claude /api/oauth/usage) beats inference", () => {
  const blind = estimate([], "claude");
  const win = (u5: number | null, u7: number | null, status = "allowed") => ({ status, "5h": { util: u5 }, "7d": { util: u7 } });

  test("binding util is max(5h, active weekly); unreachable meter is null", () => {
    expect(meterOf(win(0.3, 0.8))).toEqual({ util: 0.8, limited: false });
    expect(meterOf(win(0.3, null))).toEqual({ util: 0.3, limited: false });
    expect(meterOf(null)).toBeNull();
    expect(meterOf(win(null, null))).toBeNull();
  });

  test("util 0.25 → run; util 0.95 → standard parks, critical escalates", () => {
    expect(arbitrate(withMeter(blind, meterOf(win(0.25, null))), "standard").action).toBe("run");
    expect(arbitrate(withMeter(blind, meterOf(win(0.95, null))), "standard").action).toBe("park");
    expect(arbitrate(withMeter(blind, meterOf(win(0.95, null))), "critical").action).toBe("escalate");
  });

  test("a limited window is a block even below the floor", () => {
    const e = withMeter(blind, meterOf(win(1, null, "limited")));
    expect(e.blocked).toBe(true);
    expect(arbitrate(e, "standard").action).toBe("park");
  });

  test("no meter keeps the 429-inferred estimate unchanged", () => {
    expect(withMeter(blind, null)).toEqual(blind);
  });
});
