import { expect, test } from "bun:test";
import { buildCard, parseArgs, parseDecision, taskCard } from "./decide";
import { lintCard } from "./lint-card";

test("ask: first --opt is the rec, card passes lint, evidence goes after </decide>", () => {
  const a = parseArgs(["ask", "--q", "Keep Opus for reviews?", "--opt", "Keep Opus | Better reviews. Costs budget.", "--opt", "Qwen only | No spend. Weaker reviews.", "--evidence", "x.ts:3", "--dry"]);
  const body = buildCard({ q: a.q as string, opts: a.opt, evidence: a.evidence as string });
  expect(body).toContain('<option id="A" rec="1" title="Keep Opus">Better reviews. Costs budget.</option><option id="B" title="Qwen only">');
  expect(body.split("</decide>")[1]).toContain("Evidence: x.ts:3");
  expect(lintCard("agent-pub: review model", body)).toEqual([]);
  expect(a.dry).toBe(true);
});

test("task card is Done / Not now and lints", () => {
  const body = buildCard(taskCard("rotate the M1 password."));
  expect(body).toContain("<q>Will you rotate the M1 password today?</q>");
  expect(lintCard("trading: rotate M1 password", body)).toEqual([]);
});

test("card text with < or quotes is refused, an option without a cost too", () => {
  expect(() => buildCard({ q: 'Use "fast"?', opts: ["A | x", "B | y"] })).toThrow();
  expect(() => buildCard({ q: "Ship?", opts: ["Yes", "No | y"] })).toThrow();
});

test("parseDecision reads every /decide reply shape", () => {
  expect(parseDecision("DECISION accept B: only on Mondays")).toEqual({ verb: "accept", option: "B", until: "", note: "only on Mondays" });
  expect(parseDecision("DECISION accept: back up in gh")?.note).toBe("back up in gh");
  expect(parseDecision("DECISION defer until 2026-11-20")?.until).toBe("2026-11-20");
  expect(parseDecision("DECISION skip")?.verb).toBe("skip");
  expect(parseDecision("BLOCKED-MASTER: create repo")).toBeNull();
});
