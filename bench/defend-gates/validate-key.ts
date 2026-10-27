// BENCH_CORPUS=corpus-v2 bun validate-key.ts [--model opus] — ex-ante key audit for the hard tier.
// Hard defects risk being wrong rather than hard; a bogus keyed defect silently depresses every approach's recall.
// One independent call per case checks each keyed defect and decoy. Output: <corpus>-keycheck/<id>.json; exits 1 on any failure.
import { parseArgs } from "util";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { callJson, pool, zero, loadCorpus, CORPUS } from "./lib";

const { values: a } = parseArgs({ options: { model: { type: "string", default: "opus" } } });
const DIR = import.meta.dir, OUT = `${DIR}/${CORPUS}-keycheck`;
mkdirSync(OUT, { recursive: true });

const SYS = `You audit the answer key of a code/plan review benchmark. Be adversarial toward the KEY, not the artifact.
For each keyed defect decide: real (the described failure actually happens as stated — trace the code/arithmetic yourself), detectable (provable from CONTEXT+ARTIFACT alone, no outside facts), gate_worthy (must block the gate, not a nit), not_handled (nothing elsewhere in the artifact already prevents it).
For each decoy decide: handled (the artifact really does handle it, so flagging it would be a false positive).
If expected_verdict is CLEAR, also report any real gate-worthy problem you find (none is a valid answer).
Return ONLY JSON: {"defects":{"<id>":{"real":bool,"detectable":bool,"gate_worthy":bool,"not_handled":bool,"note":"<1 sentence>"}},"decoys":[{"handled":bool,"note":"<1 sentence>"}],"clear_problems":["<1 sentence each>"]}`;

const bad: string[] = [];
await pool(Object.values<any>(loadCorpus(DIR)), 4, async (k) => {
  const p = `${OUT}/${k.id}.json`;
  if (!existsSync(p)) {
    const u = zero();
    const key = { expected_verdict: k.expected_verdict, defects: k.defects, decoys: k.decoys };
    const { data } = await callJson(u, a.model!, SYS, `CONTEXT:\n${k.context}\n\nARTIFACT:\n${k.artifact}\n\nKEY:\n${JSON.stringify(key, null, 1)}`);
    await Bun.write(p, JSON.stringify({ case: k.id, model: a.model, usage: u, ...data }, null, 1));
  }
  const r = JSON.parse(readFileSync(p, "utf8"));
  for (const [id, v] of Object.entries<any>(r.defects ?? {}))
    if (!(v.real && v.detectable && v.gate_worthy && v.not_handled)) bad.push(`${k.id} ${id}: ${v.note}`);
  (r.decoys ?? []).forEach((d: any, i: number) => d.handled || bad.push(`${k.id} decoy${i}: ${d.note}`));
  for (const c of r.clear_problems ?? []) if (k.expected_verdict === "CLEAR") bad.push(`${k.id} CLEAR: ${c}`);
});
console.log(bad.length ? bad.join("\n") : "key OK");
process.exit(bad.length ? 1 : 0);
