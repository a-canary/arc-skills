// bun methods-check.ts [run] — method-error probes on an existing run:
//  (1) right-reason TPR: defective artifact blocked by ≥1 blocking attack that is a keyed defect or a real "extra"
//  (2) stop-early-style loop length: how many review rounds a one-finding-per-round gate needs to surface every caught defect
import { readdirSync, readFileSync } from "fs";
import { loadCorpus, isDefectLabel } from "./lib";

const RUN = process.argv[2] ?? "full", OUT = `${import.meta.dir}/results/${RUN}`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const blocking = (s: string) => s === "blocker" || s === "major";
const corpus = loadCorpus(import.meta.dir);

const agg: Record<string, { def: number; tpRight: number; tpAny: number }> = {};
for (const f of readdirSync(`${OUT}/judged`)) {
  const j = read(`${OUT}/judged/${f}`);
  if (corpus[j.case].expected_verdict === "CLEAR") continue;
  for (const [name, { labels }] of Object.entries<any>(j.judged)) {
    const r = read(`${OUT}/raw/${name}__${j.case}__r${j.rep}.json`);
    const a = (agg[name] ??= { def: 0, tpRight: 0, tpAny: 0 });
    a.def++;
    const blk = r.attacks.map((x: any, i: number) => (blocking(x.severity) ? labels[i] : null)).filter(Boolean);
    if (blk.length) a.tpAny++;
    if (blk.some((l: string) => isDefectLabel(l) || l === "extra")) a.tpRight++;
  }
}
console.log("approach            TPR(any block)  TPR(right reason)");
for (const [n, a] of Object.entries(agg)) console.log(n.padEnd(19), `${((100 * a.tpAny) / a.def).toFixed(0)}%`.padStart(8), `${((100 * a.tpRight) / a.def).toFixed(0)}%`.padStart(14));
