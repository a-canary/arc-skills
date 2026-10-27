// bun loop-report.ts --run loop — score loop-sim results → results/<run>/loop-summary.json + table on stdout.
// escaped = seeded defect still present when the gate CLEARed (shipped). Cap runs escalate to a human: their residual defects are
// reported separately, not as escapes. A regression = new gate-worthy problem the revisions introduced (escape judge).
import { parseArgs } from "util";
import { readdirSync, readFileSync, existsSync } from "fs";
import { loadCorpus } from "./lib";

const { values: a } = parseArgs({ options: { run: { type: "string", default: "loop" } } });
const DIR = import.meta.dir, OUT = `${DIR}/results/${a.run}`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const corpus = loadCorpus(DIR);
const tok = (u: any) => u.tokIn + u.tokOut;

type Agg = { def: number; clean: number; defects: number; escaped: number; residualCap: number; capDef: number; capClean: number; clearedDef: number;
  roundsDef: number; roundsClean: number; cleanFirstClear: number; regressions: number; gateTok: number; fixTok: number; gateUsd: number; fixUsd: number; ms: number; judged: number; runs: number };
const agg: Record<string, Agg> = {};
for (const f of readdirSync(`${OUT}/loop`)) {
  const st = read(`${OUT}/loop/${f}`);
  if (st.status === "running") continue;
  const k = corpus[st.case], clean = k.expected_verdict === "CLEAR";
  const e = existsSync(`${OUT}/escape/${f}`) ? read(`${OUT}/escape/${f}`) : null;
  const g = (agg[st.approach] ??= { def: 0, clean: 0, defects: 0, escaped: 0, residualCap: 0, capDef: 0, capClean: 0, clearedDef: 0, roundsDef: 0, roundsClean: 0, cleanFirstClear: 0, regressions: 0, gateTok: 0, fixTok: 0, gateUsd: 0, fixUsd: 0, ms: 0, judged: 0, runs: 0 });
  g.runs++;
  for (const r of st.rounds) { g.gateTok += tok(r.usage); g.gateUsd += r.usage.usd; g.ms += r.usage.critMs; }
  g.fixTok += tok(st.fixerUsage); g.fixUsd += st.fixerUsage.usd; g.ms += st.fixerUsage.critMs;
  if (e) { g.judged++; if (e.regression && e.regression !== "none") g.regressions++; }
  const present = e ? Object.values<string>(e.defects ?? {}).filter((v) => v === "present").length : 0;
  if (clean) {
    g.clean++; g.roundsClean += st.rounds.length;
    if (st.rounds[0].verdict === "CLEAR") g.cleanFirstClear++;
    if (st.status === "cap") g.capClean++;
  } else {
    g.def++; g.defects += k.defects.length; g.roundsDef += st.rounds.length;
    if (st.status === "cap") { g.capDef++; g.residualCap += present; } else { g.clearedDef++; g.escaped += present; }
  }
}
const pct = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)}%` : "—");
const summary = Object.entries(agg).sort().map(([n, g]) => ({ approach: n, ...g,
  escapeRate: g.defects ? g.escaped / g.defects : 0, capRateDef: g.def ? g.capDef / g.def : 0, capRateClean: g.clean ? g.capClean / g.clean : 0,
  meanRoundsDef: g.def ? g.roundsDef / g.def : 0, meanRoundsClean: g.clean ? g.roundsClean / g.clean : 0,
  tokPerCase: (g.gateTok + g.fixTok) / g.runs, minPerCase: g.ms / g.runs / 60000 }));
await Bun.write(`${OUT}/loop-summary.json`, JSON.stringify({ run: a.run, summary }, null, 1));
console.log("approach                 runs judged | escaped/defects  def→cap  rounds(def)  rounds(clean)  clean 1st-CLEAR  clean→cap  regress | gate+fix tok/case  min/case");
for (const s of summary) console.log(s.approach.padEnd(24), String(s.runs).padStart(4), String(s.judged).padStart(6), "|",
  `${s.escaped}/${s.defects} (${pct(s.escaped, s.defects)})`.padStart(15), pct(s.capDef, s.def).padStart(8), s.meanRoundsDef.toFixed(2).padStart(12),
  s.meanRoundsClean.toFixed(2).padStart(14), pct(s.cleanFirstClear, s.clean).padStart(16), pct(s.capClean, s.clean).padStart(10), String(s.regressions).padStart(8), "|",
  `${(s.tokPerCase / 1000).toFixed(1)}k`.padStart(17), s.minPerCase.toFixed(1).padStart(9));
