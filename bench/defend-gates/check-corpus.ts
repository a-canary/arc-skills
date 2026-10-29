// bun check-corpus.ts — schema + ground-truth sanity for corpus/*.json. Exits 1 on any violation.
import { readdirSync, readFileSync } from "fs";
import { LENSES } from "./approaches";

const dir = `${import.meta.dir}/corpus`;
const lenses = new Set([...Object.keys(LENSES), "other"]);
const errs: string[] = [], lensCount: Record<string, number> = {};
let defects = 0, clean = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const k = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const e = (m: string) => errs.push(`${f}: ${m}`);
  for (const key of ["id", "gate", "title", "context", "artifact", "expected_verdict", "defects", "decoys"]) if (!(key in k)) e(`missing ${key}`);
  if (`${k.id}.json` !== f) e("id/filename mismatch");
  if (!["plan", "merge", "deploy"].includes(k.gate)) e(`bad gate ${k.gate}`);
  if ((k.expected_verdict === "CLEAR") !== (k.defects.length === 0)) e("verdict/defects mismatch");
  if (k.expected_verdict === "CLEAR") { clean++; if (!k.decoys.length) e("CLEAR case without decoys"); }
  const lines = k.artifact.split("\n").length;
  if (lines < 35 || lines > 170) e(`artifact ${lines} lines`);
  for (const d of k.defects) {
    defects++;
    lensCount[d.lens] = (lensCount[d.lens] ?? 0) + 1;
    if (!lenses.has(d.lens)) e(`${d.id} bad lens ${d.lens}`);
    if (!["blocker", "major"].includes(d.severity)) e(`${d.id} bad severity`);
    if (!d.evidence.startsWith("ABSENT") && !k.artifact.includes(d.evidence)) e(`${d.id} evidence quote not in artifact`);
  }
  // Signposting check: the artifact must not admit its own bugs.
  if (/TODO|FIXME|HACK|insecure|vulnerab/i.test(k.artifact)) e("artifact contains signpost word");
}
console.log({ defects, clean, lensCount });
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
console.log("corpus OK");
