import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { topUp, parsePrompts, decide } from "./topup";

test("3 real -> 13 synthetic; second run is a cache hit with no model call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "topup-"));
  let calls = 0;
  const gen = async (_s: string, _seeds: unknown[], need: number) => { calls++; return Array.from({ length: need }, (_, i) => `synthetic task ${i}`); };
  const real = [1, 2, 3].map((i) => ({ id: `r${i}`, prompt: `real ${i}` }));
  const a = await topUp(real, "# SKILL v1", { target: 16, cacheDir: dir, gen });
  expect(a.rows.length).toBe(16);
  expect([a.real, a.synthetic, a.cached]).toEqual([3, 13, false]);
  expect(a.rows.slice(0, 3).every((r) => !r.synthetic)).toBe(true);
  expect(a.rows.slice(3).every((r) => r.synthetic)).toBe(true);
  const b = await topUp(real, "# SKILL v1", { target: 16, cacheDir: dir, gen });
  expect([b.synthetic, b.cached, calls]).toEqual([13, true, 1]);
  await topUp(real, "# SKILL v2", { target: 16, cacheDir: dir, gen });
  expect(calls).toBe(2); // new SKILL.md hash regenerates
  const full = await topUp(Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, prompt: "p" })), "# SKILL v1", { target: 16, cacheDir: dir, gen });
  expect([full.synthetic, calls]).toEqual([0, 2]); // 16 real: no top-up
});

test("parsePrompts extracts array from chatter", () => {
  expect(parsePrompts('sure: ["a","b"] done')).toEqual(["a", "b"]);
});

const V = (winner: string, synthetic: boolean, n: number) => Array.from({ length: n }, () => ({ winner, synthetic }));

test("3 real losses + 13 synthetic wins -> HOLD (real loss rejects)", () => {
  const d = decide([...V("champion", false, 3), ...V("challenger", true, 13)]);
  expect(d.verdict).toBe("HOLD");
  expect([d.rw, d.rl, d.sw, d.sl]).toEqual([0, 3, 13, 0]);
});

test("zero real losses -> pooled Wilson decides", () => {
  expect(decide([...V("challenger", false, 3), ...V("challenger", true, 13)]).verdict).toBe("PROMOTE");
  expect(decide([...V("challenger", true, 3), ...V("champion", true, 3)]).verdict).toBe("HOLD");
});

test("nightly topup uses incumbent (champion) spec, never the challenger", () => {
  const sh = readFileSync(join(import.meta.dir, "../../bin/nightly-self-improve.sh"), "utf8");
  const line = sh.split("\n").find((l) => l.includes(" topup "))!;
  expect(line).toContain('--spec "$w/champion.md"');
  expect(line).not.toContain("challenger.md");
});
