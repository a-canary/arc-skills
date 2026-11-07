import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCard, parseArgs, pinRun } from "../human-gate-post-webui/decide";
import { lintCard } from "../human-gate-post-webui/lint-card";
import { type Deps, main } from "./deploy-run";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const GOOD = "#!/bin/bash\n# undo: systemctl start foo\nsystemctl restart foo\n";

function setup(script: string, opts: { hex?: string; verb?: string; path?: string; author?: string } = {}) {
  const q = "/q";
  const path = opts.path ?? `${q}/abcd1234-x.sh`;
  const desc = `<decide></decide>\nRun: ${path} sha256: ${opts.hex ?? sha(script)}\n`;
  const files: Record<string, string> = { [path]: script, "/fences": readFileSync(join(import.meta.dir, "fences.txt"), "utf8") };
  const d: Deps = {
    bd: (_dir, ...a) => a[0] === "show" ? JSON.stringify([{ description: desc }]) : JSON.stringify([{ author: opts.author ?? "operator", text: `DECISION ${opts.verb ?? "accept"}: ok` }]),
    readFile: (p) => files[p] ?? "",
    queueDir: q,
    fencesFile: "/fences",
    exec: () => { throw new Error("must not execute"); },
    logChange: () => { throw new Error("must not log"); },
  };
  return d;
}
const run = (d: Deps, ...flags: string[]) => { const out: string[] = []; const code = main(["card-1", ...flags], d, (s) => out.push(s)); return { code, out: out.join("\n") }; };

test("hash mismatch refused", () => expect(run(setup(GOOD, { hex: "0".repeat(64) })).code).toBe(3));
test("missing undo refused", () => expect(run(setup("echo hi\n")).code).toBe(3));
test("fenced script refused", () => {
  expect(run(setup(GOOD + "cp x /etc/sudoers.d/y\n")).code).toBe(3);
  expect(run(setup(GOOD + "vi ~/.claude/hooks/a.sh\n")).code).toBe(3);
  expect(run(setup(GOOD + "visudo\n")).code).toBe(3);
});
test("path outside queue refused", () => expect(run(setup(GOOD, { path: "/tmp/x.sh" })).code).toBe(3));
test("non-accept refused", () => expect(run(setup(GOOD, { verb: "reject" })).code).toBe(3));
test("accept by a non-operator author refused", () => expect(run(setup(GOOD, { author: "agent" })).code).toBe(3));
test("--dry prints the plan and never executes", () => {
  const r = run(setup(GOOD), "--dry");
  expect(r.code).toBe(0);
  expect(r.out).toContain("DRY RUN");
  expect(r.out).toContain("undo: systemctl start foo");
  expect(r.out).toContain("fence: clear");
});
test("operator accept runs the hashed bytes and logs the change with its undo", () => {
  const d = setup(GOOD);
  const ran: string[] = [], logged: string[] = [];
  d.exec = (t) => { ran.push(t); return 0; };
  d.logChange = (l) => { logged.push(l); };
  expect(run(d).code).toBe(0);
  expect(ran).toEqual([GOOD]);
  expect(logged.join("")).toContain("undo: systemctl start foo");
});
test("decide --run pins the hash and the card still lints", () => {
  const dir = mkdtempSync(join(tmpdir(), "dq-"));
  const script = join(dir, "fix.sh");
  writeFileSync(script, GOOD);
  const line = pinRun(script, join(dir, "queue"));
  expect(line).toContain(`sha256: ${sha(GOOD)}`);
  expect(line).toContain(`${sha(GOOD).slice(0, 8)}-fix.sh`);
  const body = buildCard({ q: "Run the fix?", opts: ["Run it | Fixes foo. Runs as root.", "Skip | Nothing changes. Foo stays broken."], evidence: "x.ts:3" }) + `\n${line}\n`;
  expect(lintCard("arc-skills: run the foo fix", body)).toEqual([]);
  expect(parseArgs(["ask", "--run", script]).run).toBe(script);
});
