// skillopt.test.ts — fixture gate for `mine --skill` (bun test).
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const now = new Date().toISOString();
const old = new Date(Date.now() - 30 * 86400_000).toISOString();
const u = (content: any, extra: any = {}) => ({ type: "user", sessionId: "s1", timestamp: now, message: { role: "user", content }, ...extra });
const a = (content: any[], ts = now) => ({ type: "assistant", sessionId: "s1", timestamp: ts, message: { role: "assistant", content } });
const skillUse = (id: string, skill: string, args?: string) => ({ type: "tool_use", id, name: "Skill", input: { skill, ...(args ? { args } : {}) } });
const result = (id: string) => u([{ type: "tool_result", tool_use_id: id, content: "Launching skill" }]);

test("mine --skill extracts prompt+args and post-result assistant turns", () => {
  const root = mkdtempSync(join(tmpdir(), "skillopt-"));
  mkdirSync(join(root, "proj"));
  const lines = [
    u("please route the batch job"),
    a([skillUse("t1", "arc:scheduler", "--lane v100")]),
    result("t1"),
    u([{ type: "text", text: "SKILL BODY should not end collection" }], { isMeta: true }),
    a([{ type: "text", text: "Routing to v100." }]),
    a([{ type: "tool_use", id: "b1", name: "Bash", input: { command: "bd ready" } }]),
    u([{ type: "tool_result", tool_use_id: "b1", content: "ok" }]),
    a([{ type: "text", text: "Queued." }]),
    u("thanks, next thing"),
    a([{ type: "text", text: "AFTER next user msg - excluded" }]),
    a([skillUse("t2", "scheduler-extra")]),            // different skill: no row
    a([skillUse("t3", "scheduler")], old),              // outside --days: no row
    { ...a([skillUse("t4", "scheduler")]), isSidechain: true }, // sidechain: no row
    u("plain"),
    a([skillUse("t5", "scheduler")]),                   // no result yet at EOF -> output null
  ];
  writeFileSync(join(root, "proj", "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = join(root, "out.jsonl");
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "skillopt.ts"), "mine", "--skill", "scheduler", "--days", "14", "--root", root, "--out", out]);
  expect(r.exitCode).toBe(0);
  const rows = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(rows.map((x) => x.id)).toEqual(["t1", "t5"]);
  expect(rows[0].prompt).toBe("please route the batch job\n\n[skill args] --lane v100");
  expect(rows[0].session).toBe("s1");
  expect(rows[0].output).toContain("Routing to v100.");
  expect(rows[0].output).toContain("[tool_use Bash]");
  expect(rows[0].output).toContain("Queued.");
  expect(rows[0].output).not.toContain("SKILL BODY");
  expect(rows[0].output).not.toContain("excluded");
  expect(rows[1].prompt).toBe("plain");
  expect(rows[1].output).toBeNull();
});
