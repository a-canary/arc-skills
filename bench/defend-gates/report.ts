// bun report.ts --run <name>  → results/<run>/summary.json + report.html (embeds analysis.html fragment if present)
import { parseArgs } from "util";
import { readdirSync, readFileSync, existsSync } from "fs";
import { APPROACHES } from "./approaches";

const { values: a } = parseArgs({ options: { run: { type: "string", default: "dev" } } });
const DIR = import.meta.dir, OUT = `${DIR}/results/${a.run}`;
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const corpus = Object.fromEntries(readdirSync(`${DIR}/corpus`).filter((f) => f.endsWith(".json")).map((f) => { const k = read(`${DIR}/corpus/${f}`); return [k.id, k]; }));
const judged = readdirSync(`${OUT}/judged`).map((f) => read(`${OUT}/judged/${f}`));
const blocking = (s: string) => s === "blocker" || s === "major";

type Row = { approach: string; case: string; gate: string; rep: number; expected: string; got: string; defects: any[];
  caughtGated: Set<string>; caughtAny: Set<string>; caughtTop3: Set<string>; extraBlocking: number; bogus: number; wrong: number; decoyBlocking: number; decoy: number; nit: number; extra: number; attacks: number;
  tok: number; usd: number; calls: number; critMs: number };
const rows: Row[] = [];
for (const j of judged) {
  const k = corpus[j.case];
  for (const [n, { labels }] of Object.entries<any>(j.judged)) {
    const r = read(`${OUT}/raw/${n}__${j.case}__r${j.rep}.json`);
    const row: Row = { approach: n, case: j.case, gate: k.gate, rep: j.rep, expected: k.expected_verdict, got: r.verdict, defects: k.defects,
      caughtGated: new Set(), caughtAny: new Set(), caughtTop3: new Set(), extraBlocking: 0, bogus: 0, wrong: 0, decoyBlocking: 0, decoy: 0, nit: 0, extra: 0, attacks: r.attacks.length,
      tok: r.usage.tokIn + r.usage.tokOut, usd: r.usage.usd, calls: r.usage.calls, critMs: r.usage.critMs };
    // Top-3 by severity (stable): what a consumer reading only the head of the verdict sees.
    const rank = { blocker: 0, major: 1, minor: 2 } as Record<string, number>;
    const top3 = new Set(r.attacks.map((x: any, i: number) => [rank[x.severity] ?? 3, i]).sort((p: number[], q: number[]) => p[0] - q[0] || p[1] - q[1]).slice(0, 3).map((p: number[]) => p[1]));
    r.attacks.forEach((x: any, i: number) => {
      const l = String(labels[i] ?? "wrong");
      if (["wrong", "decoy", "nit"].includes(l) && blocking(x.severity)) row.bogus++;
      if (l === "extra" && blocking(x.severity)) row.extraBlocking++;
      if (/^d\d+$/.test(l) && top3.has(i) && blocking(x.severity)) row.caughtTop3.add(l);
      if (/^d\d+$/.test(l)) { row.caughtAny.add(l); if (blocking(x.severity)) row.caughtGated.add(l); }
      else if (l === "decoy") { row.decoy++; if (blocking(x.severity)) row.decoyBlocking++; }
      else if (l === "wrong") row.wrong++;
      else if (l === "nit") row.nit++;
      else if (l === "extra") row.extra++;
    });
    rows.push(row);
  }
}

const mean = (xs: number[]) => xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN;
const median = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
// Case-level bootstrap (resample cases, keep all reps of a case together).
function boot(rs: Row[], stat: (rs: Row[]) => number, B = 2000): [number, number] {
  const byCase = Object.values(Object.groupBy(rs, (r) => r.case)) as Row[][];
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const v = Array.from({ length: B }, () => stat(byCase.flatMap(() => byCase[Math.floor(rnd() * byCase.length)]))).filter((x) => !isNaN(x)).sort((p, q) => p - q);
  return [v[Math.floor(v.length * 0.025)], v[Math.floor(v.length * 0.975)]];
}
const recall = (rs: Row[], gated = true, sev?: string, set: "caughtGated" | "caughtAny" | "caughtTop3" = gated ? "caughtGated" : "caughtAny") => {
  let c = 0, t = 0;
  for (const r of rs) for (const d of r.defects) if (!sev || d.severity === sev) { t++; if (r[set].has(d.id)) c++; }
  return t ? c / t : NaN;
};
// Disputed control: plan-03's rollback never carries Ghost-side unsubscribes back to MailPoet. All 9 phase-1 approaches flagged it
// and judge pass 1 rated it a real unkeyed problem ("extra"); pass 2 rated the same attacks "nit". The key may be wrong, so TNR is
// reported excluding it (headline) and on the raw key (grey). A judge-derived rule was tried first and was unstable across passes.
const contested = new Set(["plan-03"]);
const tpr = (rs: Row[]) => mean(rs.filter((r) => r.expected === "ATTACKS").map((r) => +(r.got === "ATTACKS")));
const tnrRaw = (rs: Row[]) => mean(rs.filter((r) => r.expected === "CLEAR").map((r) => +(r.got === "CLEAR")));
const tnr = (rs: Row[]) => tnrRaw(rs.filter((r) => !contested.has(r.case)));
const bacc = (rs: Row[]) => (tpr(rs) + tnr(rs)) / 2;

const names = Object.keys(APPROACHES).filter((n) => rows.some((r) => r.approach === n));
const lenses = [...new Set(Object.values<any>(corpus).flatMap((k) => k.defects.map((d: any) => d.lens)))].sort();
const gates = [...new Set(Object.values<any>(corpus).map((k) => k.gate))].sort();

// Infra faults (unparseable output / CLI failure after retries) — rerun fills them, but the fault rate is itself a robustness result.
const faults = existsSync(`${OUT}/errors.jsonl`) ? readFileSync(`${OUT}/errors.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const summary = names.map((n) => {
  const rs = rows.filter((r) => r.approach === n);
  const agree = (() => { const by = Object.groupBy(rs, (r) => r.case); const v = Object.values(by).filter((x) => x!.length > 1).map((x) => +(new Set(x!.map((r) => r.got)).size === 1)); return mean(v); })();
  const nonDupAttacks = rs.reduce((s, r) => s + r.caughtAny.size + r.wrong + r.decoy + r.nit + r.extra, 0);
  return {
    approach: n, desc: APPROACHES[n].desc, runs: rs.length,
    recallGated: recall(rs), recallGatedCI: boot(rs, (x) => recall(x)), recallAny: recall(rs, false), recallBlocker: recall(rs, true, "blocker"),
    recallTop3: recall(rs, true, undefined, "caughtTop3"),
    tpr: tpr(rs), tnr: tnr(rs), tnrRaw: tnrRaw(rs), bacc: bacc(rs), baccCI: boot(rs, bacc),
    falseBlockRate: 1 - tnr(rs), decoyBlockingPerRun: mean(rs.map((r) => r.decoyBlocking)),
    bogusPerRun: mean(rs.map((r) => r.bogus)), wrongPerRun: mean(rs.map((r) => r.wrong)), nitPerRun: mean(rs.map((r) => r.nit)), extraPerRun: mean(rs.map((r) => r.extra)), attacksPerRun: mean(rs.map((r) => r.attacks)),
    precision: nonDupAttacks ? rs.reduce((s, r) => s + r.caughtAny.size + r.extra, 0) / nonDupAttacks : NaN,
    tokPerRun: mean(rs.map((r) => r.tok)), usdPerRun: mean(rs.map((r) => r.usd)), callsPerRun: mean(rs.map((r) => r.calls)),
    critMsMedian: median(rs.map((r) => r.critMs)), repAgreement: agree, infraFaults: faults.filter((x) => x.n === n).length,
    byGate: Object.fromEntries(gates.map((g) => { const x = rs.filter((r) => r.gate === g); return [g, { recall: recall(x), bacc: bacc(x) }]; })),
    byLens: Object.fromEntries(lenses.map((l) => { let c = 0, t = 0; for (const r of rs) for (const d of r.defects) if (d.lens === l) { t++; if (r.caughtGated.has(d.id)) c++; } return [l, { c, t }]; })),
  };
});
const judgeUsd = judged.reduce((s, j) => s + j.judgeUsage.usd, 0);
const approachUsd = rows.reduce((s, r) => s + r.usd, 0);
await Bun.write(`${OUT}/summary.json`, JSON.stringify({ run: a.run, cases: Object.keys(corpus).length, judgedCaseReps: judged.length, judgeUsd, approachUsd, contested: [...contested], summary }, null, 1));

// ---------- HTML
const pct = (x: number) => isNaN(x) ? "–" : (100 * x).toFixed(0) + "%";
const ci = (c: [number, number]) => `<span class=ci>${pct(c[0])}–${pct(c[1])}</span>`;
const f = (x: number, d = 1) => isNaN(x) ? "–" : x.toFixed(d);
const usd = (x: number) => "$" + x.toFixed(3);
const best = (key: keyof typeof summary[0], hi = true) => { const v = summary.map((s) => s[key] as number); return hi ? Math.max(...v) : Math.min(...v); };
const td = (v: number, key: any, txt: string, hi = true) => `<td class="${v === best(key, hi) ? "best" : ""}">${txt}</td>`;

const table = `<table><thead><tr><th>approach</th><th>calls</th><th>defect recall (gated) · 95% CI</th><th>recall@3</th><th>TPR</th><th>TNR (clean→CLEAR) · raw key</th><th>balanced acc · 95% CI</th><th>bogus blockers/run</th><th>precision</th><th>tokens/run</th><th>$/run (list)</th><th>crit-path s</th><th>rep agree</th><th>infra faults</th></tr></thead><tbody>
${summary.map((s) => `<tr><td><b>${s.approach}</b><div class=desc>${s.desc}</div></td><td>${f(s.callsPerRun)}</td>${td(s.recallGated, "recallGated", pct(s.recallGated) + " " + ci(s.recallGatedCI))}${td(s.recallTop3, "recallTop3", pct(s.recallTop3))}${td(s.tpr, "tpr", pct(s.tpr))}${td(s.tnr, "tnr", pct(s.tnr) + ` <span class=ci>${pct(s.tnrRaw)}</span>`)}${td(s.bacc, "bacc", pct(s.bacc) + " " + ci(s.baccCI))}${td(s.bogusPerRun, "bogusPerRun", f(s.bogusPerRun, 2), false)}${td(s.precision, "precision", pct(s.precision))}${td(s.tokPerRun, "tokPerRun", Math.round(s.tokPerRun).toLocaleString(), false)}${td(s.usdPerRun, "usdPerRun", usd(s.usdPerRun), false)}${td(s.critMsMedian, "critMsMedian", f(s.critMsMedian / 1000), false)}<td>${pct(s.repAgreement)}</td><td>${s.infraFaults}</td></tr>`).join("\n")}
</tbody></table>`;

const lensTable = `<table class=small><thead><tr><th>lens</th>${summary.map((s) => `<th>${s.approach}</th>`).join("")}</tr></thead><tbody>
${lenses.map((l) => `<tr><td>${l} <span class=ci>n=${summary[0].byLens[l].t}</span></td>${summary.map((s) => { const { c, t } = s.byLens[l]; const v = t ? c / t : NaN; return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(v * 70)}%, transparent)">${pct(v)}</td>`; }).join("")}</tr>`).join("\n")}
</tbody></table>`;

const gateTable = `<table class=small><thead><tr><th>gate</th>${summary.map((s) => `<th>${s.approach}</th>`).join("")}</tr></thead><tbody>
${gates.map((g) => `<tr><td>${g}</td>${summary.map((s) => `<td>${pct(s.byGate[g].recall)} / ${pct(s.byGate[g].bacc)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table><p class=ci>cell = gated defect recall / balanced verdict accuracy</p>`;

// Scatter: cost (log x) vs gated recall.
const W = 640, H = 360, P = 48;
const xs = summary.map((s) => Math.log10(s.usdPerRun)), xmin = Math.min(...xs) - 0.15, xmax = Math.max(...xs) + 0.15;
const X = (v: number) => P + ((Math.log10(v) - xmin) / (xmax - xmin)) * (W - 2 * P), Y = (v: number) => H - P - v * (H - 2 * P);
const ticks = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1].filter((t) => Math.log10(t) >= xmin && Math.log10(t) <= xmax);
const scatter = `<svg viewBox="0 0 ${W} ${H}" role=img aria-label="cost per run vs balanced verdict accuracy">
<g class=axis>${[0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1=${P} x2=${W - P} y1=${Y(v)} y2=${Y(v)} /><text x=${P - 6} y=${Y(v) + 4} text-anchor=end>${pct(v)}</text>`).join("")}
${ticks.map((t) => `<text x=${X(t)} y=${H - P + 16} text-anchor=middle>$${t}</text>`).join("")}
<text x=${W / 2} y=${H - 8} text-anchor=middle>list $ per gate run (log)</text><text x=12 y=${H / 2} transform="rotate(-90 12 ${H / 2})" text-anchor=middle>balanced verdict accuracy</text></g>
${summary.map((s) => `<g class=pt><circle cx=${X(s.usdPerRun)} cy=${Y(s.bacc)} r=${3 + 6 * s.recallTop3} /><text x=${X(s.usdPerRun) + 9} y=${Y(s.bacc) + 4}>${s.approach}</text></g>`).join("")}
</svg><p class=ci>dot size ∝ recall@3</p>`;

const analysis = existsSync(`${OUT}/analysis.html`) ? readFileSync(`${OUT}/analysis.html`, "utf8") : "<p><i>analysis pending</i></p>";
const nDef = Object.values<any>(corpus).reduce((s, k) => s + k.defects.length, 0), nClean = Object.values<any>(corpus).filter((k) => k.expected_verdict === "CLEAR").length;

await Bun.write(`${OUT}/report.html`, `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Defend Gate Bench</title><style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#e3e1da;--accent:#2f6fde;--best:#e3f0dc}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mute:#9a988f;--line:#33322e;--accent:#6b9cf0;--best:#23361d}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:24px 16px}
h1{font-size:26px;margin:0 0 4px}h2{margin-top:36px;border-bottom:1px solid var(--line);padding-bottom:4px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:600}.small td,.small th{font-size:12.5px;padding:4px 6px}td.best{background:var(--best);font-weight:600}
.desc,.ci{color:var(--mute);font-size:12px}svg{width:100%;max-width:720px}.axis line{stroke:var(--line)}.axis text,.pt text{fill:var(--mute);font-size:11px}
.pt circle{fill:var(--accent);opacity:.75}.pt text{fill:var(--fg)}code{font-size:13px}
</style></head><body>
<h1>Defend Gate Bench — how to run multi-perspective phase gates</h1>
<p class=ci>run <code>${a.run}</code> · ${Object.keys(corpus).length} cases (${nDef} seeded defects, ${nClean} clean controls) · ${judged.length} judged case-reps · worker tier = haiku, strong tier = sonnet, judge = opus (blind, shuffled) · judge spend ${usd(judgeUsd)} · generated ${new Date().toISOString().slice(0, 16)}Z</p>
${analysis}
<h2>Scoreboard</h2><div class=wrap>${table}</div>
<p class=ci>gated recall = seeded defect caught by a blocker/major attack · TPR = defective artifact → ATTACKS · TNR = clean artifact → CLEAR, contested controls excluded (grey = raw key) · recall@3 = defect caught by a blocking attack ranked in the top 3 · bogus blockers = blocker/major attacks the judge labelled wrong, decoy or nit · precision = (seeded+valid extra)/(non-dup attacks) · $ = Claude list price reported by the CLI (subscription seat in practice) · crit-path = sum over stages of the slowest call (parallel fan-out assumed) · CIs = case-level bootstrap.</p>
<h2>Cost vs effectiveness</h2>${scatter}
<h2>Recall by lens</h2><div class=wrap>${lensTable}</div>
<h2>By gate type</h2><div class=wrap>${gateTable}</div>
</body></html>`);
console.log(`wrote ${OUT}/report.html, summary.json (${rows.length} rows)`);
