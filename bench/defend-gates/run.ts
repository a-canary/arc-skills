// bun run.ts --run <name> [--approaches a,b] [--cases id,id] [--reps 2] [--judge-only]
// Resumable: every (approach, case, rep) and every judged (case, rep) is a file; existing files are skipped.
import { parseArgs } from "util";
import { mkdirSync, existsSync, readdirSync, appendFileSync } from "fs";
import { APPROACHES, type Case, type Result } from "./approaches";
import { callJson, pool, zero } from "./lib";

const { values: a } = parseArgs({ options: {
  run: { type: "string", default: "dev" }, approaches: { type: "string" }, cases: { type: "string" },
  reps: { type: "string", default: "1" }, "judge-only": { type: "boolean" }, judge: { type: "string", default: "opus" },
} });

const DIR = import.meta.dir;
const OUT = `${DIR}/results/${a.run}`;
mkdirSync(`${OUT}/raw`, { recursive: true });
mkdirSync(`${OUT}/judged`, { recursive: true });

type Key = Case & { expected_verdict: string; defects: { id: string; lens: string; severity: string; description: string; evidence: string }[]; decoys: string[] };
const corpus: Key[] = readdirSync(`${DIR}/corpus`).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(require("fs").readFileSync(`${DIR}/corpus/${f}`, "utf8")))
  .filter((k: Key) => !a.cases || a.cases.split(",").includes(k.id));
const names = a.approaches ? a.approaches.split(",") : Object.keys(APPROACHES);
const reps = Array.from({ length: Number(a.reps) }, (_, i) => i + 1);
const rawPath = (n: string, id: string, r: number) => `${OUT}/raw/${n}__${id}__r${r}.json`;
const log = (m: string) => console.log(new Date().toISOString().slice(11, 19), m);

if (!a["judge-only"]) {
  const jobs = corpus.flatMap((k) => reps.flatMap((r) => names.map((n) => ({ k, r, n })))).filter((j) => !existsSync(rawPath(j.n, j.k.id, j.r)));
  log(`${jobs.length} approach runs to do`);
  let done = 0;
  // Job-level fan-out is high; lib.ts caps concurrent claude processes globally.
  await pool(jobs, 24, async ({ k, r, n }) => {
    const t0 = Date.now();
    try {
      const res: Result = await APPROACHES[n].fn(k);
      await Bun.write(rawPath(n, k.id, r), JSON.stringify({ approach: n, case: k.id, rep: r, wallMs: Date.now() - t0, ...res }, null, 1));
      log(`[${++done}/${jobs.length}] ${n} ${k.id} r${r} → ${res.verdict} (${res.attacks.length} attacks, ${res.usage.calls} calls)`);
    } catch (e) {
      // Infra faults are logged and retried on the next invocation — never recorded as a verdict.
      appendFileSync(`${OUT}/errors.jsonl`, JSON.stringify({ n, case: k.id, r, err: String(e) }) + "\n");
      log(`ERR ${n} ${k.id} r${r}: ${String(e).slice(0, 160)}`);
    }
  });
}

// ---- Blind judge: one call per (case, rep) labels every attack of every approach, anonymized + shuffled.
const LABELS = `For EACH attack, output exactly one label:
- a defect id (e.g. "d2") if the attack identifies that seeded defect's underlying problem (same problem + location; lens name and wording do not matter)
- "decoy" if it flags one of the listed decoys (something the artifact already handles)
- "extra" if it is a real, gate-worthy problem that is not in the key (be strict: must be genuinely blocking and supported by the artifact)
- "nit" if it is true but not gate-worthy
- "wrong" if it is unsupported by the artifact, factually false, or misreads it
- "dup" if it restates an earlier attack in the SAME submission`;

function seeded(s: string) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 2 ** 32); }

const judgeJobs = corpus.flatMap((k) => reps.map((r) => ({ k, r }))).filter(({ k, r }) => !existsSync(`${OUT}/judged/${k.id}__r${r}.json`));
let jdone = 0;
await pool(judgeJobs, 4, async ({ k, r }) => {
  const subs = Object.keys(APPROACHES).filter((n) => existsSync(rawPath(n, k.id, r)))
    .map((n) => ({ n, res: JSON.parse(require("fs").readFileSync(rawPath(n, k.id, r), "utf8")) as Result }));
  if (subs.length < Object.keys(APPROACHES).length) return log(`judge skip ${k.id} r${r}: ${subs.length} subs`);
  const rnd = seeded(`${k.id}-${r}`);
  const order = subs.map((s) => ({ s, x: rnd() })).sort((p, q) => p.x - q.x).map((p) => p.s);
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  const withAttacks = order.map((s, i) => ({ L: letters[i], s })).filter((o) => o.s.res.attacks.length);
  let labels: Record<string, string[]> = {};
  const u = zero();
  if (withAttacks.length) {
    const body = withAttacks.map(({ L, s }) => `### Submission ${L}\n` + s.res.attacks.map((x, j) => `${j}. [${x.severity}] (${x.lens}) ${x.claim} — evidence: ${x.evidence}`).join("\n")).join("\n\n");
    const key = { expected_verdict: k.expected_verdict, defects: k.defects.map(({ id, lens, description, evidence }) => ({ id, lens, description, evidence })), decoys: k.decoys };
    const { data } = await callJson<Record<string, string[]>>(u, a.judge!,
      `You are a meticulous benchmark judge. You score gate-review submissions against a hidden answer key. Be strict and consistent; judge each attack on its content only.\n\n${LABELS}\n\nReturn ONLY JSON: {"<submission letter>":["label for attack 0","label for attack 1",...], ...} with one label per attack, in order, for every submission listed.`,
      `CASE:\nCONTEXT:\n${k.context}\n\nARTIFACT:\n${k.artifact}\n\nANSWER KEY:\n${JSON.stringify(key, null, 1)}\n\nSUBMISSIONS:\n${body}`);
    labels = data;
  }
  const out = Object.fromEntries(order.map((s, i) => {
    const l = labels[letters[i]] ?? [];
    if (l.length !== s.res.attacks.length) log(`WARN judge label count ${k.id} r${r} ${s.n}: ${l.length} vs ${s.res.attacks.length}`);
    return [s.n, { letter: letters[i], labels: l }];
  }));
  await Bun.write(`${OUT}/judged/${k.id}__r${r}.json`, JSON.stringify({ case: k.id, rep: r, judgeUsage: u, judged: out }, null, 1));
  log(`judged [${++jdone}/${judgeJobs.length}] ${k.id} r${r}`);
});
log("done");
