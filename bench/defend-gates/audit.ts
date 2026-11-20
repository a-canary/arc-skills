// bun audit.ts --run <name> [--n 20] [--approach x] — print random judge matches (defect ↔ attack) for human audit of judge leniency.
import { parseArgs } from "util";
import { readdirSync, readFileSync } from "fs";

const { values: a } = parseArgs({ options: { run: { type: "string", default: "dev" }, n: { type: "string", default: "20" }, approach: { type: "string" }, label: { type: "string" } } });
const DIR = import.meta.dir, OUT = `${DIR}/results/${a.run}`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const pairs: string[] = [];
for (const f of readdirSync(`${OUT}/judged`)) {
  const j = read(`${OUT}/judged/${f}`), k = read(`${DIR}/corpus/${j.case}.json`);
  for (const [n, { labels }] of Object.entries<any>(j.judged)) {
    if (a.approach && n !== a.approach) continue;
    const r = read(`${OUT}/raw/${n}__${j.case}__r${j.rep}.json`);
    labels.forEach((l: string, i: number) => {
      const want = a.label ? l === a.label : isDefectLabel(l);
      if (!want) return;
      const d = k.defects.find((d: any) => d.id === l);
      pairs.push(`## ${j.case} r${j.rep} ${n} → ${l}\nKEY: ${d ? d.description : "(not a defect)"}\nATTACK [${r.attacks[i].severity}]: ${r.attacks[i].claim}`);
    });
  }
}
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
console.log(`${pairs.length} matches; showing ${a.n}\n\n` + pairs.slice(0, Number(a.n)).join("\n\n"));
