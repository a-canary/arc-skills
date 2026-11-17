// lint-card.test.ts — the card lint passes the skill's own example and rejects the 10-31 failure shapes (bun test).

import { expect, test } from "bun:test";
import { lintCard } from "./lint-card.ts";

const good = `<decide><q>Which model may the agent-pub container use?</q><context>agent-pub moves into a rootless container whose only network path is the lane proxy.</context><option id="A" rec="1" title="Qwen only (V100)">No Claude spend, nothing secret in the container. Weaker reviews on hard diffs.</option><option id="B" title="Keep Opus">Reviews keep today's quality. Costs Claude budget and a credential in the container.</option></decide>

Operator adds: whether a weaker reviewer is worth keeping a credential out of the container.
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
  const real = new Set(["trading-qch2", "repos-vlqa", "repos-sim", "wb-pia", "arc-985.1"]), isBead = (t: string) => real.has(t);
  expect(lintCard("[Deploy] Run card trading-qch2 now", good, isBead).join(" ")).toContain("title: no bead ids (trading-qch2)");
  expect(lintCard("[Deploy] Read-only access for the bot", good)).toEqual([]);
  for (const t of ["[Deploy] Restart arc-webui on 8080", "[Deploy] Pause the trading-bot", "[Design] Fix the arc-llm-proxy", "[Design] Split webui-specs"])
    expect(lintCard(t, good, isBead)).toEqual([]);
  for (const t of ["[Deploy] Close repos-vlqa first", "[Deploy] Drop repos-sim", "[Design] Fix wb-pia", "[Deploy] Finish arc-985.1"])
    expect(lintCard(t, good, isBead).join(" ")).toContain("no bead ids");
  expect(lintCard("[Design] Keep Qwen", good.replace(/<context>[\s\S]*?<\/context>/, "")).join(" ")).toContain("Problem line");
});

// repos-0f2e, operator 2026-11-16 18:10Z: "this is me being a meat proxy ... maximize my contribution per card".
// Every card names the judgement only the operator adds; running or re-approving reviewed work is not one.
test("a card must say what the operator's judgement adds", () => {
  const none = good.replace(/^Operator adds:.*\n/m, "");
  expect(lintCard("[Design] Keep Qwen", none).join(" ")).toContain("Operator adds:");
  const thin = good.replace(/^Operator adds:.*$/m, "Operator adds: approval");
  expect(lintCard("[Design] Keep Qwen", thin).join(" ")).toContain("Operator adds:");
  const inside = good.replace(/^Operator adds:.*\n/m, "").replace("</context>", " Operator adds: whether a weaker reviewer is worth it.</context>");
  expect(lintCard("[Design] Keep Qwen", inside).join(" ")).toContain("Operator adds:");
});

test("meat-proxy cards are refused", () => {
  const cases: [string, string][] = [
    ["[Deploy] Re-accept the live pull", good],
    ["[Deploy] Reapprove the merge", good],
    ["[Deploy] Keep Qwen", good.replace("Which model may the agent-pub container use?", "Will you run the reviewed pull?")],
    ["[Task] Keep Qwen", good.replace('title="Keep Opus">', 'title="Paste this line">')],
    ["[Deploy] Keep Qwen", good.replace("No Claude spend", "Type this command for me. No Claude spend")],
    ["[Deploy] Keep Qwen", good.replace(/^Operator adds:.*$/m, "Operator adds: re-run the approved command after the agent bug")],
  ];
  for (const [title, body] of cases) expect(lintCard(title, body).join(" ")).toContain("meat-proxy");
});

test("a Run card with real judgement passes", () =>
  expect(lintCard("[Deploy] Run the drop-folder installer", good.replace('title="Qwen only (V100)"', 'title="Run the installer"'))).toEqual([]));

// repos-jedj (operator 2026-11-16 23:10Z): "cards be for taste, not for permissions". A Lead grants permission
// (deploy-run --grant after a review CLEAR); a permission card passes only when it names an operator hard line.
test("permission-only cards are refused, hard-line ones pass", () => {
  const perm = (q: string, adds = "whether the agents may touch the shared box at all tonight, with access to its public mission choices.") =>
    good.replace("Which model may the agent-pub container use?", q).replace(/^Operator adds:.*$/m, `Operator adds: ${adds}`);
  for (const q of ["May I run the job-drop fix as root?", "OK to restart the proxy?", "Can I install the hook now?", "Do I have permission to pull main?", "Will you approve the root script?"])
    expect(lintCard("[Deploy] Run the fix", perm(q)).join(" ")).toContain("permission-only");
  for (const adds of ["whether to spend $40 of vast credit this week.", "whether the repo goes public.", "whether to place the live order before the open."])
    expect(lintCard("[Deploy] Run the fix", perm("May I run the job-drop fix as root?", adds))).toEqual([]);
  expect(lintCard("[Deploy] Run the fix", perm("May I spend $40 of vast credit on this run?"))).toEqual([]);
  for (const q of ["Which model can we use for agent-pub?", "How can we split the shards?", "Should the bot auto-approve reviews?", "What permission model should the hook use?", "Which go-ahead signal should the bot wait for?"])
    expect(lintCard("[Design] Keep Qwen", perm(q))).toEqual([]);
  expect(lintCard("[Design] Keep Qwen", good)).toEqual([]);
});
