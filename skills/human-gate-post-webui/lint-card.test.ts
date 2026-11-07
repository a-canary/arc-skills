// lint-card.test.ts — the card lint passes the skill's own example and rejects the 10-31 failure shapes (bun test).

import { expect, test } from "bun:test";
import { lintCard } from "./lint-card.ts";

const good = `<decide><q>Which model may the agent-pub container use?</q><context>agent-pub moves into a rootless container whose only network path is the lane proxy.</context><option id="A" rec="1" title="Qwen only (V100)">No Claude spend, nothing secret in the container. Weaker reviews on hard diffs.</option><option id="B" title="Keep Opus">Reviews keep today's quality. Costs Claude budget and a credential in the container.</option></decide>

Evidence: tick.sh:12 defaults MODEL=claude-opus-5-5 (paths and SHAs are fine down here)`;

test("skill example passes", () => expect(lintCard("[Design] Keep Qwen in the agent-pub container", good)).toEqual([]));

test("FYI with no decision is rejected", () =>
  expect(lintCard("host power-cycled", "Router rebooted at 10:55, back up.").join(" ")).toContain("no decision"));

test("prose Options: A)… card is rejected", () =>
  expect(lintCard("DECIDE: merge PR", "Options: A) merge (recommended) | B) revise").join(" ")).toContain("no <decide>"));

test("rec must exist and lead", () => {
  expect(lintCard("t", good.replace(' rec="1"', ""))).toContain("0 rec=\"1\", need exactly 1");
  const late = good.replace(' rec="1"', "").replace('id="B"', 'id="B" rec="1"');
  expect(lintCard("t", late)).toContain("the rec option goes first");
});

test("SHAs and paths stay out of the headline", () => {
  const err = lintCard("deploy 6d117461 to ~/repos/trading/", good.replace("container use?", "container use at 89cad53?"));
  expect(err).toContain("title: no commit SHAs");
  expect(err).toContain("title: no file paths");
  expect(err).toContain("<q>: no commit SHAs");
});

test("slash word lists are not paths", () =>
  expect(lintCard("[Deploy] Approve/deny/defer the upgrade", good)).toEqual([]));

test("two questions in one card are rejected", () =>
  expect(lintCard("t", good.replace("container use?", "container use? And who pays?"))).toContain("<q>: one question only"));

test("title needs [Design|Prototype|Deploy|Task] and no bead ids; context (Problem) is required", () => {
  expect(lintCard("trading: deploy fixes", good).join(" ")).toContain("start with [Design|Prototype|Deploy|Task]");
  expect(lintCard("[Deploy] Run card trading-qch2 now", good)).toContain("title: no bead ids");
  expect(lintCard("[Deploy] Read-only access for the bot", good)).toEqual([]);
  for (const t of ["[Deploy] Restart arc-webui on 8080", "[Deploy] Pause the trading-bot", "[Design] Fix the arc-sim harness"]) expect(lintCard(t, good)).toEqual([]);
  expect(lintCard("[Deploy] Close repos-vlqa first", good)).toContain("title: no bead ids");
  expect(lintCard("[Design] Keep Qwen", good.replace(/<context>[\s\S]*?<\/context>/, "")).join(" ")).toContain("Problem line");
});
