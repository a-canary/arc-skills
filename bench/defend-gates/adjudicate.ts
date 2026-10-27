// bun adjudicate.ts [run] [modelA] [modelB] — replace vote-based "disputed control" exclusion with independent adjudication.
// Every blocking attack the judge labelled "extra" (real, unkeyed) on a CLEAN case is a nomination. Two models from different
// vendors rule on each distinct issue; the key is amended (case → ATTACKS with the new defect) only where BOTH rule "defect".
// Splits go to results/<run>/adjudication.json for a human. Output: corpus-amend/<case>.json, read by report.ts.
import { readdirSync, readFileSync, mkdirSync, existsSync } from "fs";
import { callJson, zero, CORPUS } from "./lib";

const [RUN = "full", A = "opus", B = "v100:qwen3.8-27b"] = process.argv.slice(2);
const DIR = import.meta.dir, OUT = `${DIR}/results/${RUN}`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const blocking = (s: string) => s === "blocker" || s === "major";
mkdirSync(`${DIR}/${CORPUS}-amend`, { recursive: true });

const noms: Record<string, Set<string>> = {};
for (const dir of ["judged", "judged-pass1"].filter((d) => existsSync(`${OUT}/${d}`))) for (const f of readdirSync(`${OUT}/${dir}`)) {
  const j = read(`${OUT}/${dir}/${f}`), k = read(`${DIR}/${CORPUS}/${j.case}.json`);
  if (k.expected_verdict !== "CLEAR") continue;
  for (const [n, { labels }] of Object.entries<any>(j.judged)) {
    const r = read(`${OUT}/raw/${n}__${j.case}__r${j.rep}.json`);
    r.attacks.forEach((x: any, i: number) => { if (labels[i] === "extra" && blocking(x.severity)) (noms[j.case] ??= new Set()).add(x.claim); });
  }
}

const SYS = `You are an independent adjudicator for a review benchmark. The document below was authored as a CLEAN control (no gate-worthy problems). Reviewers nominated the issues listed. Group the nominations into distinct underlying issues. For each, rule:
- "defect": a real problem that a careful senior reviewer would BLOCK on, clearly supported by the document text (not speculation, not a nice-to-have, not something the document already handles);
- "not": otherwise.
Return ONLY JSON: {"issues":[{"summary":"<one sentence>","ruling":"defect"|"not","reason":"<one sentence>","lens":"<lens slug>","severity":"blocker"|"major","evidence":"<verbatim quote from the document>"}]}`;

const report: any[] = [];
for (const [c, set] of Object.entries(noms)) {
  const k = read(`${DIR}/${CORPUS}/${c}.json`);
  const user = `CONTEXT:\n${k.context}\n\nDOCUMENT:\n${k.artifact}\n\nAUTHOR'S NOTES — intentionally fine (decoys):\n${JSON.stringify(k.decoys)}\n\nNOMINATIONS:\n${[...set].map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  const [ra, rb] = await Promise.all([A, B].map((m) => callJson(zero(), m, SYS, user).then((r) => r.data.issues as any[])));
  // Pair B's issues to A's by asking A-side defects to be confirmed by any B-side defect (one-shot, issue counts are small).
  const bDefects = rb.filter((i) => i.ruling === "defect");
  const pair = bDefects.length ? (await callJson(zero(), A, `Match issue summaries. Return ONLY JSON {"matches":[[<a index>,<b index>],...]} pairing items that describe the same underlying problem.`,
    `A:\n${ra.map((i, n) => `${n}. ${i.summary}`).join("\n")}\n\nB:\n${bDefects.map((i, n) => `${n}. ${i.summary}`).join("\n")}`)).data.matches as [number, number][] : [];
  const agreed = ra.filter((i, n) => i.ruling === "defect" && pair.some(([x]) => x === n));
  report.push({ case: c, nominations: set.size, A: ra, B: rb, agreed: agreed.map((i) => i.summary) });
  if (agreed.length) await Bun.write(`${DIR}/${CORPUS}-amend/${c}.json`, JSON.stringify({ case: c, adjudicators: [A, B],
    defects: agreed.map((i, n) => ({ id: `x${n + 1}`, lens: i.lens, severity: i.severity, description: i.summary, evidence: i.evidence })) }, null, 1));
  console.log(c, `noms=${set.size}`, `A defects=${ra.filter((i) => i.ruling === "defect").length}/${ra.length}`, `B defects=${bDefects.length}/${rb.length}`, `agreed=${agreed.length}`);
}
await Bun.write(`${OUT}/adjudication.json`, JSON.stringify(report, null, 1));
