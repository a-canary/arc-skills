import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Deps, main } from "./deploy-run";

// repos-jedj part 1: a Lead grants a run without a card. deploy-run itself has an independent model review the
// exact script bytes (Deps.review) and runs only on CLEAR. Scripts naming anything still reserved for the operator
// (human-only.txt: money, live trading, force push, --admin, visibility/access) stay card-only.
const GOOD = "#!/bin/bash\n# undo: systemctl --user start foo\nsystemctl --user restart foo\n";
const P = "/q/abcd1234-x.sh";
const here = import.meta.dir;

function setup(script: string, verdict: "CLEAR" | "BLOCK" = "CLEAR") {
  const files: Record<string, string> = {
    [P]: script,
    "/fences": readFileSync(join(here, "fences.txt"), "utf8"),
    "/human-only": readFileSync(join(here, "human-only.txt"), "utf8"),
  };
  const calls = { exec: [] as boolean[], log: [] as string[], review: [] as string[] };
  const d: Deps = {
    bd: () => { throw new Error("grant path must not read a card"); },
    readFile: (p) => files[p] ?? "",
    queueDir: "/q",
    fencesFile: "/fences",
    humanOnlyFile: "/human-only",
    review: (text) => { calls.review.push(text); return { clear: verdict === "CLEAR", line: `VERDICT: ${verdict} by=local` }; },
    exec: (_p, asUser) => { calls.exec.push(asUser); return 0; },
    logChange: (l) => { calls.log.push(l); },
  };
  return { d, calls };
}
const run = (d: Deps, ...argv: string[]) => main(argv, d, () => {});

test("CLEAR review + granting Lead runs the script as root and logs lead, review and undo", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", P)).toBe(0);
  expect(calls.review).toEqual([GOOD]);
  expect(calls.exec).toEqual([false]);
  const log = calls.log.join("");
  expect(log).toContain("grant: agents-lead");
  expect(log).toContain("VERDICT: CLEAR by=local");
  expect(log).toContain("undo: systemctl --user start foo");
  expect(log).toContain(createHash("sha256").update(GOOD).digest("hex").slice(0, 12));
});

test("BLOCK review refuses and runs nothing", () => {
  const { d, calls } = setup(GOOD, "BLOCK");
  expect(run(d, "--grant", "agents-lead", "--script", P)).toBe(3);
  expect(calls.exec).toEqual([]);
});

test("human-only scripts stay card-only: refused before review", () => {
  for (const line of [
    "cd /home/aaron/repos/trading && git pull --ff-only",
    "bun tools/order.ts buy SPY 1",
    "git push --force origin main",
    "git push -f origin main",
    "gh pr merge 3 --admin",
    "gh repo edit a-canary/x --visibility public",
    "vastai create instance 123",
  ]) {
    const { d, calls } = setup(GOOD + line + "\n");
    expect(run(d, "--grant", "agents-lead", "--script", P)).toBe(3);
    expect(calls.review).toEqual([]);
    expect(calls.exec).toEqual([]);
  }
});

test("existing fences and the undo line still apply on the grant path", () => {
  for (const s of [GOOD + "visudo\n", "#!/bin/bash\nsystemctl --user restart foo\n"]) {
    const { d, calls } = setup(s);
    expect(run(d, "--grant", "agents-lead", "--script", P)).toBe(3);
    expect(calls.exec).toEqual([]);
  }
});

test("script outside the queue dir refused", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", "/tmp/x.sh")).toBe(3);
  expect(calls.exec).toEqual([]);
});

test("--grant and --script need each other and a non-flag value", () => {
  for (const argv of [["--grant", "agents-lead"], ["--script", P], ["--grant", "--script", P], ["--grant", "agents-lead", "--script"]]) {
    const { d, calls } = setup(GOOD);
    expect(run(d, ...argv)).toBe(3);
    expect(calls.exec).toEqual([]);
  }
});

test("--dry on the grant path reviews but never executes or logs", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", P, "--dry")).toBe(0);
  expect(calls.exec).toEqual([]);
  expect(calls.log).toEqual([]);
});

test("--as-user on the grant path runs as the invoking user", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", P, "--as-user")).toBe(0);
  expect(calls.exec).toEqual([true]);
});
