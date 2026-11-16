import { expect, test } from "bun:test";
import { buildCard, parseArgs, parseDecision, taskCard, textCard } from "./decide";
import { lintCard } from "./lint-card";

test("ask: first --opt is the rec, card passes lint, evidence goes after </decide>", () => {
  const a = parseArgs(["ask", "--q", "Keep Opus for reviews?", "--opt", "Keep Opus | Better reviews. Costs budget.", "--opt", "Qwen only | No spend. Weaker reviews.", "--evidence", "x.ts:3", "--dry"]);
  const body = buildCard({ q: a.q as string, opts: a.opt, evidence: a.evidence as string, context: "The fix is ready.", adds: "whether better reviews are worth the budget." });
  expect(body).toContain('<option id="A" rec="1" title="Keep Opus">Better reviews. Costs budget.</option><option id="B" title="Qwen only">');
  expect(body.split("</decide>")[1]).toContain("Evidence: x.ts:3");
  expect(lintCard("[Design] Keep Opus for container reviews", body)).toEqual([]);
  expect(a.dry).toBe(true);
});

test("task card is Done / Not now and lints", () => {
  const body = buildCard({ ...taskCard("rotate the M1 password."), context: "The old password leaked.", adds: "only the operator holds the M1 account login." });
  expect(body).toContain("<q>Will you rotate the M1 password today?</q>");
  expect(lintCard("[Task] Rotate the M1 password today", body)).toEqual([]);
});

test("card text with < or quotes is refused, an option without a cost too", () => {
  expect(() => buildCard({ q: 'Use "fast"?', opts: ["A | x", "B | y"] })).toThrow();
  expect(() => buildCard({ q: "Ship?", opts: ["Yes", "No | y"] })).toThrow();
});

test("empty question, empty task, and 5 options are refused; a text card lints", () => {
  expect(() => taskCard(" ")).toThrow();
  expect(() => buildCard({ q: "", opts: ["A | x", "B | y"] })).toThrow();
  expect(() => buildCard({ q: "Which?", opts: ["A | x", "B | y", "C | z", "D | w", "E | v"] })).toThrow();
  expect(lintCard("[Design] Point the agent at the spec", buildCard({ ...textCard("Which repo holds the spec?", "skip the spec check"), context: "No spec found.", adds: "which repo the operator treats as the source of the spec." }))).toEqual([]);
});

test("parseDecision reads every /decide reply shape", () => {
  expect(parseDecision("DECISION accept B: only on Mondays")).toEqual({ verb: "accept", option: "B", until: "", note: "only on Mondays" });
  expect(parseDecision("DECISION accept: back up in gh")?.note).toBe("back up in gh");
  expect(parseDecision("DECISION defer until 2026-11-20")?.until).toBe("2026-11-20");
  expect(parseDecision("DECISION skip")?.verb).toBe("skip");
  expect(parseDecision("BLOCKED-MASTER: create repo")).toBeNull();
});

test("--adds lands as the Operator adds line after </decide>", () => {
  const body = buildCard({ q: "Ship?", opts: ["Yes | x", "No | y"], adds: "whether the risk is worth it today.", evidence: "e" });
  expect(body).toMatch(/<\/decide>\n\nOperator adds: whether the risk is worth it today\.\nEvidence: e\n/);
  expect(parseArgs(["--adds", "taste"]).adds).toBe("taste");
});
