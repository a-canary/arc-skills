import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { topUp, parsePrompts } from "./topup";

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
