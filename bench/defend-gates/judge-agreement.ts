// bun judge-agreement.ts <judgedDirA> <judgedDirB> <rawDir> — test-retest reliability of the blind judge across two passes.
import { readdirSync, readFileSync, existsSync } from "fs";

const [A, B, RAW] = process.argv.slice(2);
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const coarse = (l: string) => (/^d\d+$/.test(l) ? "defect" : l);
let n = 0, exact = 0, coarseAgree = 0, catchAgree = 0, catchN = 0;
const confusion: Record<string, number> = {};
for (const f of readdirSync(A)) {
  if (!existsSync(`${B}/${f}`)) continue;
  const ja = read(`${A}/${f}`), jb = read(`${B}/${f}`);
  for (const [name, va] of Object.entries<any>(ja.judged)) {
    const vb = jb.judged[name];
    if (!vb) continue;
    const r = read(`${RAW}/${name}__${ja.case}__r${ja.rep}.json`);
    va.labels.forEach((la: string, i: number) => {
      const lb = vb.labels[i];
      n++;
      if (la === lb) exact++;
      if (coarse(la) === coarse(lb)) coarseAgree++;
      else confusion[`${coarse(la)}→${coarse(lb)}`] = (confusion[`${coarse(la)}→${coarse(lb)}`] ?? 0) + 1;
    });
    // Defect-catch set agreement (what recall is computed from).
    const set = (ls: string[]) => new Set(ls.filter((l, i) => /^d\d+$/.test(l) && r.attacks[i].severity !== "minor"));
    const sa = set(va.labels), sb = set(vb.labels);
    for (const d of new Set([...sa, ...sb])) { catchN++; if (sa.has(d) && sb.has(d)) catchAgree++; }
  }
}
console.log({ attacks: n, exactAgree: +(exact / n).toFixed(3), coarseAgree: +(coarseAgree / n).toFixed(3), defectCatchAgree: +(catchAgree / catchN).toFixed(3),
  topDisagreements: Object.entries(confusion).sort((p, q) => q[1] - p[1]).slice(0, 8) });
