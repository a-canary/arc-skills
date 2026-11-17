import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// repos-ugssm: a human-only line is matched per script, so a pattern must not join two lines into one hit.
const lines = readFileSync(join(import.meta.dir, "human-only.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
const hit = (text: string) => lines.some((l) => new RegExp(l).test(text));

test("a pre-push path then a later -f file test is not a force push", () => {
  expect(hit("dst=/home/aaron/.git-hooks/pre-push\nset -eu\n[ -f \"$src\" ] || exit 1\n")).toBe(false);
});

test("a real force push still hits", () => {
  expect(hit("git push --force origin main\n")).toBe(true);
  expect(hit("git push -f origin main\n")).toBe(true);
  expect(hit("git push origin +main\n")).toBe(true);
});
