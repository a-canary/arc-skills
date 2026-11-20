// bun loop.ts --run loop [--approaches a,b] [--cases id,id] [--rounds 5] [--tag v100] [--fixer sonnet] [--judge opus]
// Gates run in a loop in practice: review → author revises against the blocking attacks → re-review, until CLEAR or the
// round cap (= escalate to a human). One-shot scoring misreads loop-native designs like stop-early, so this measures the loop:
// which seeded defects survive to the final artifact, rounds to CLEAR, non-convergence, and total spend.
// Resumable per round: results/<run>/loop/<approach>[@tag]__<case>.json; escape judge → .../escape/<same>.json.
// Set BENCH_W / BENCH_S (approaches.ts) with --tag to run a tier on another backend, e.g. BENCH_W=v100:qwen3.8-27b --tag v100.
import { parseArgs } from "util";
import { mkdirSync, existsSync, readdirSync, readFileSync, appendFileSync } from "fs";
import { APPROACHES, type Attack } from "./approaches";
import { call, callJson, pool, zero, add, loadCorpus } from "./lib";

const { values: a } = parseArgs({ options: {
  run: { type: "string", default: "loop" }, approaches: { type: "string" }, cases: { type: "string" }, rounds: { type: "string", default: "5" },
  tag: { type: "string" }, fixer: { type: "string", default: "sonnet" }, judge: { type: "string", default: "opus" }, jobs: { type: "string", default: "12" },
} });
const DIR = import.meta.dir, OUT = `${DIR}/results/${a.run}`;
for (const d of ["loop", "escape"]) mkdirSync(`${OUT}/${d}`, { recursive: true });
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const corpus = Object.values(loadCorpus(DIR))
  .filter((k: any) => !a.cases || a.cases.split(",").includes(k.id));
const names = (a.approaches ?? "rubric-stop-early,rubric-single,single-strong").split(",");
const R = Number(a.rounds), id = (n: string) => (a.tag ? `${n}@${a.tag}` : n);
const log = (m: string) => console.log(new Date().toISOString().slice(11, 19), m);
const blocking = (x: Attack) => x.severity === "blocker" || x.severity === "major";

const FIXER = `You are the author of the artifact below. A review gate blocked it with the objections listed.
For each objection: if it identifies a real problem, change the artifact to fix it. If you judge it mistaken or already handled, do not change the substance; add a brief clarification where a reader would look for it.
Keep everything else unchanged, in the same format. Output ONLY the full revised artifact, no preamble.`;

async function runLoop(n: string, k: any) {
  const path = `${OUT}/loop/${id(n)}__${k.id}.json`;
  const st = existsSync(path) ? read(path) : { approach: id(n), case: k.id, rounds: [], artifact: k.artifact, fixerUsage: zero(), status: "running" };
  while (st.status === "running") {
    const t0 = Date.now();
    const res = await APPROACHES[n].fn({ ...k, artifact: st.artifact });
    st.rounds.push({ verdict: res.verdict, attacks: res.attacks, usage: res.usage, wallMs: Date.now() - t0 });
    if (res.verdict === "CLEAR") st.status = "cleared";
    else if (st.rounds.length >= R) st.status = "cap";
    else {
      const objections = res.attacks.filter(blocking).map((x, i) => `${i + 1}. [${x.severity}] (${x.lens}) ${x.claim} — evidence: ${x.evidence}`).join("\n");
      const c = await call(a.fixer!, FIXER, `CONTEXT:\n${k.context}\n\nARTIFACT:\n${st.artifact}\n\nOBJECTIONS:\n${objections}`);
      add(st.fixerUsage, c);
      st.fixerUsage.critMs += c.ms;
      st.artifact = c.text.trim();
    }
    await Bun.write(path, JSON.stringify(st, null, 1));
  }
  log(`${id(n)} ${k.id} → ${st.status} after ${st.rounds.length} round(s)`);
}

// Escape judge: one call per (approach, case), sees only that submission's final artifact — no cross-approach consensus.
async function judgeEscape(n: string, k: any) {
  const lp = `${OUT}/loop/${id(n)}__${k.id}.json`, ep = `${OUT}/escape/${id(n)}__${k.id}.json`;
  if (existsSync(ep) || !existsSync(lp)) return;
  const st = read(lp);
  if (st.status === "running") return;
  const u = zero();
  const defects = k.defects.map(({ id, description, evidence }: any) => ({ id, description, evidence }));
  const { data } = await callJson(u, a.judge!,
    `You audit a revised document against a known list of problems the ORIGINAL had. Be strict: a problem is "fixed" only if the revised text actually removes it (a disclaimer or promise to look into it is not a fix).
Return ONLY JSON: {"defects":{"<id>":"fixed"|"present"}, "regression":"none" | "<one sentence: a NEW gate-worthy problem the revision introduced that the original did not have>"}`,
    `CONTEXT:\n${k.context}\n\nORIGINAL:\n${k.artifact}\n\nKNOWN PROBLEMS IN ORIGINAL:\n${JSON.stringify(defects, null, 1)}\n\nREVISED:\n${st.artifact}`);
  await Bun.write(ep, JSON.stringify({ approach: id(n), case: k.id, judgeUsage: u, ...data }, null, 1));
}

const jobs = corpus.flatMap((k: any) => names.map((n) => ({ n, k })));
await pool(jobs, Number(a.jobs), async ({ n, k }) => {
  try { await runLoop(n, k); await judgeEscape(n, k); }
  catch (e) { appendFileSync(`${OUT}/errors.jsonl`, JSON.stringify({ n: id(n), case: k.id, err: String(e) }) + "\n"); log(`ERR ${id(n)} ${k.id}: ${String(e).slice(0, 160)}`); }
});
log("done");
