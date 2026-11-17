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
    // repos-kqylt: spellings that slipped the first patterns (defend-attack at be8ba2b).
    "bun tools/order buy SPY 1",
    "bun run tools/order buy SPY 1",
    "gh api -X PATCH repos/a-canary/x -f visibility=public",
    "gh api --method PATCH repos/a-canary/x -F private=false",
    "gh api -X DELETE repos/a-canary/x",
    "gh api --method=DELETE repos/a-canary/x",
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

// review verdict: only the reviewer's LAST non-empty stdout line counts, exactly `VERDICT: CLEAR by=<who>`, and exit 0.
import { reviewVerdict, LEAD } from "./deploy-run";
test("verdict parsing: last line only, exact CLEAR, exit 0", () => {
  expect(reviewVerdict("Note: x\nVERDICT: CLEAR by=opus\n", 0).clear).toBe(true);
  expect(reviewVerdict("VERDICT: CLEAR by=local\nBlocking: y\nVERDICT: BLOCK by=opus\n", 0).clear).toBe(false);
  expect(reviewVerdict("VERDICT: CLEARLY fine\n", 0).clear).toBe(false);
  expect(reviewVerdict("VERDICT: CLEAR by=opus\n", 1).clear).toBe(false);
  expect(reviewVerdict("", 0).clear).toBe(false);
  expect(reviewVerdict("VERDICT: CLEAR by=opus\nextra\n", 0).clear).toBe(false);
  expect(reviewVerdict("Blocking: z\nVERDICT: BLOCK by=opus\n", 1).line).toBe("VERDICT: BLOCK by=opus");
  // A BLOCK keeps its reasons so the caller does not have to rerun a full review to learn why.
  expect(reviewVerdict("Note: n\nBlocking: a\nBlocking: b\nVERDICT: BLOCK by=opus\n", 0).reasons).toEqual(["Blocking: a", "Blocking: b"]);
  expect(reviewVerdict("VERDICT: CLEAR by=opus\n", 0).reasons).toEqual([]);
});

test("lead names: one plain token; newlines and spaces refused", () => {
  for (const ok of ["agents-lead", "trading-lead", "assistant"]) expect(LEAD.test(ok)).toBe(true);
  for (const bad of ["x\n- exit: 0", "agents lead", "", "A".repeat(50), "../x"]) expect(LEAD.test(bad)).toBe(false);
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "x\n- exit: 0", "--script", P)).toBe(3);
  expect(calls.exec).toEqual([]);
});

test("script path with a newline or other odd characters refused before review", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", "/q/x\n- exit: 0.sh")).toBe(3);
  expect(run(d, "--grant", "agents-lead", "--script", "/q/x y.sh")).toBe(3);
  expect(calls.review).toEqual([]);
});

test("--grant refuses a card id or --repo alongside it", () => {
  const { d, calls } = setup(GOOD);
  expect(run(d, "--grant", "agents-lead", "--script", P, "repos-abc")).toBe(3);
  expect(run(d, "--grant", "agents-lead", "--script", P, "--repo", "arc")).toBe(3);
  expect(calls.exec).toEqual([]);
});

test("reviewer path ignores a caller-set HOME", () => {
  const r = Bun.spawnSync(["bun", "-e", "import { DEFEND_ATTACK } from './deploy-run'; console.log(DEFEND_ATTACK)"], {
    cwd: here, env: { ...process.env, HOME: "/tmp/hb-fake-home" },
  });
  expect(r.stdout.toString()).not.toContain("/tmp/hb-fake-home");
  expect(r.stdout.toString()).toContain("/.claude/skills/defend/bin/defend-attack");
});

test("reviewer env is an allow-list: no DEFEND_* override or caller PATH reaches it", () => {
  const r = Bun.spawnSync(["bun", "-e", "import { REVIEW_ENV } from './deploy-run'; console.log(JSON.stringify(REVIEW_ENV))"], {
    cwd: here, env: { ...process.env, HOME: "/tmp/hb-fake-home", PATH: `/tmp/evil:${process.env.PATH}`, DEFEND_OPUS_CMD: "echo CLEAR" },
  });
  const env = JSON.parse(r.stdout.toString());
  expect(Object.keys(env).sort()).toEqual(["HOME", "LANG", "PATH", "USER"]);
  expect(env.PATH).not.toContain("/tmp/evil");
  expect(env.HOME).not.toContain("/tmp/hb-fake-home");
});

// repos-f9azm: reasons echo text the untrusted script shaped, so control characters (C0 and C1) are removed and the
// total is capped before they reach the Lead.
test("BLOCK reasons carry no control characters and are capped", () => {
  const r = reviewVerdict(`Blocking: a \x1b[31mred\x1b[0m \x9b2J b\nBlocking: ${"x".repeat(6000)}\nVERDICT: BLOCK by=opus\n`, 0);
  expect(r.reasons.join("\n")).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  expect(r.reasons[0]).toBe("Blocking: a [31mred[0m 2J b");
  expect(r.reasons.join("\n").length).toBeLessThanOrEqual(4000);
});

// PR 222 review: the verdict line and its by= token are untrusted-shaped too.
test("verdict line carries no control characters and by= is a plain name", () => {
  expect(reviewVerdict("VERDICT: CLEAR by=\x1b[2Jopus\n", 0).clear).toBe(false);
  expect(reviewVerdict("VERDICT: CLEAR by=op\x85us\n", 0).clear).toBe(false);
  expect(reviewVerdict("VERDICT: BLOCK by=\x1b[2Jopus\n", 0).line).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  expect(reviewVerdict("VERDICT: CLEAR by=local-qwen_3.6\n", 0).clear).toBe(true);
  expect(reviewVerdict(`VERDICT: BLOCK by=opus ${"x".repeat(10000)}\n`, 0).line.length).toBeLessThanOrEqual(200);
});
