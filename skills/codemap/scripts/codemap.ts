#!/usr/bin/env -S npx tsx
/**
 * codemap — deterministic codebase snapshot → PlantUML + report.
 *
 * Zero LLM. Zero hard deps (Node builtins only; uses `git` and `rg` if present).
 * Stages: detect → inventory → graph → signals → render.
 *
 * Usage:
 *   npx tsx codemap.ts [projectDir] [--out DIR] [--detail file|module] [--include-external]
 *
 * Emits into <out> (default <projectDir>/codemap — git-tracked, commit it):
 *   codemap.puml   PlantUML component diagram (module-level by default)
 *   codemap.md     Snapshot report with YAML frontmatter
 *   codemap.json   Raw graph IR (commit it → `git diff codemap/codemap.json` is the structural delta)
 *
 * --vs <ref> additionally writes codemap.diff.md comparing <ref> → working tree.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- types ----------
type Kind = "source" | "test" | "config" | "doc" | "output" | "other";
interface FileRec {
  rel: string;
  kind: Kind;
  loc: number;
  lang: string;
  imports: string[]; // resolved rel paths (local only)
  externals: string[]; // bare specifiers
  exports: string[]; // exported symbol names (best-effort)
  shebang?: boolean;
  frontmatter?: Record<string, unknown>;
}
interface Graph {
  root: string;
  ecosystems: string[];
  files: Record<string, FileRec>;
  entrypoints: string[];
}

// ---------- args ----------
const args = process.argv.slice(2);
function flag(name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
const has = (name: string) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const root = path.resolve(positional[0] || ".");
const outDir = path.resolve(root, flag("out", path.join(root, "codemap"))!);
const detail = flag("detail", "module") as "file" | "module";
const includeExternal = has("include-external");

const log = (m: string) => process.stderr.write(`[codemap] ${m}\n`);

// ---------- helpers ----------
function sh(cmd: string, cmdArgs: string[]): string | null {
  try {
    return execFileSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}
const exists = (p: string) => fs.existsSync(path.join(root, p));

const SRC_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];
const langOf = (rel: string): string => {
  const e = path.extname(rel);
  return { ".ts": "ts", ".tsx": "ts", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".py": "py", ".go": "go", ".rs": "rs" }[e] || e.slice(1) || "?";
};
const isTest = (rel: string) =>
  /(^|\/)(test|tests|__tests__|spec|e2e)(\/|$)/i.test(rel) || /\.(test|spec)\.[a-z]+$/i.test(rel) || /_test\.(py|go)$/i.test(rel);
const isOutput = (rel: string) =>
  /(^|\/)(dist|build|out|coverage|logs?|\.next|\.turbo|__pycache__|target)(\/|$)/i.test(rel) || /\.(log|lcov|map)$/i.test(rel);
const CONFIG_NAMES =
  /(^|\/)(package\.json|tsconfig.*\.json|pyproject\.toml|setup\.cfg|setup\.py|requirements.*\.txt|Cargo\.toml|go\.mod|\.eslintrc.*|eslint\.config\.[jt]s|biome\.jsonc?|\.prettierrc.*|vite\.config\.[jt]s|vitest\.config\.[jt]s|jest\.config\.[jt]s|\.env(\..+)?|Dockerfile|docker-compose\.ya?ml|Makefile|\.gitignore)$/i;

function kindOf(rel: string): Kind {
  if (isOutput(rel)) return "output";
  if (CONFIG_NAMES.test(rel) || /^\.github\/.*\.ya?ml$/i.test(rel)) return "config";
  if (rel.endsWith(".md") || rel.endsWith(".mdx")) return "doc";
  if (SRC_EXT.includes(path.extname(rel))) return isTest(rel) ? "test" : "source";
  return "other";
}

// ---------- stage 1: detect ----------
function detect(): string[] {
  const eco: string[] = [];
  if (exists("package.json")) eco.push("node");
  if (exists("tsconfig.json")) eco.push("typescript");
  if (exists("pyproject.toml") || exists("setup.py") || exists("requirements.txt")) eco.push("python");
  if (exists("go.mod")) eco.push("go");
  if (exists("Cargo.toml")) eco.push("rust");
  return eco.length ? eco : ["unknown"];
}

// ---------- stage 2: inventory ----------
function listFiles(): string[] {
  const tracked = sh("git", ["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (tracked) return tracked.split("\n").filter(Boolean);
  // fallback walk
  const out: string[] = [];
  const skip = /(^|\/)(node_modules|\.git|dist|build|coverage|__pycache__|\.venv|venv|target|\.next)(\/|$)/;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (skip.test(rel)) continue;
      if (e.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(root);
  return out;
}

function parseFrontmatter(text: string): Record<string, unknown> | undefined {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return undefined;
  const fm: Record<string, unknown> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return Object.keys(fm).length ? fm : undefined;
}

// import extractors
const IMPORT_RE = [
  /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];
const PY_IMPORT_RE = [/^\s*from\s+([.\w]+)\s+import\b/gm, /^\s*import\s+([.\w]+)/gm];
const EXPORT_RE = [
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
  /\bexport\s*\{\s*([^}]+)\}/g,
];

function resolveLocal(fromRel: string, spec: string, allFiles: Set<string>): string | null {
  if (!spec.startsWith(".")) return null; // external / bare
  const baseDir = path.dirname(fromRel);
  const target = path.normalize(path.join(baseDir, spec)).replace(/\\/g, "/");
  const cands = [
    target,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"].map((e) => target + e),
    // .js specifier in TS source → resolve to .ts
    ...(target.endsWith(".js") ? [target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx")] : []),
    ...["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"].map((e) => `${target}/${e}`),
  ];
  for (const c of cands) if (allFiles.has(c)) return c;
  return null;
}

function inventory(allRel: string[]): Record<string, FileRec> {
  const set = new Set(allRel);
  const recs: Record<string, FileRec> = {};
  for (const rel of allRel) {
    const kind = kindOf(rel);
    const lang = langOf(rel);
    let text = "";
    try {
      const st = fs.statSync(path.join(root, rel));
      if (st.size > 2 * 1024 * 1024) {
        recs[rel] = { rel, kind, loc: 0, lang, imports: [], externals: [], exports: [] };
        continue;
      }
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const loc = text ? text.split("\n").length : 0;
    const rec: FileRec = { rel, kind, loc, lang, imports: [], externals: [], exports: [] };
    if (kind === "doc") rec.frontmatter = parseFrontmatter(text);
    if (kind === "source" || kind === "test") {
      if (text.startsWith("#!")) rec.shebang = true;
      const res = lang === "py" ? PY_IMPORT_RE : IMPORT_RE;
      const specs = new Set<string>();
      for (const re of res) {
        re.lastIndex = 0;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(text))) specs.add(mm[1]);
      }
      for (const s of specs) {
        const local = lang === "py" ? null : resolveLocal(rel, s, set);
        if (local) rec.imports.push(local);
        else if (!s.startsWith(".")) rec.externals.push(s.split("/").slice(0, s.startsWith("@") ? 2 : 1).join("/"));
      }
      for (const re of EXPORT_RE) {
        re.lastIndex = 0;
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(text))) {
          for (const nm of mm[1].split(",")) {
            const clean = nm.trim().split(/\s+as\s+/)[0].trim();
            if (clean && /^[A-Za-z0-9_$]+$/.test(clean)) rec.exports.push(clean);
          }
        }
      }
    }
    recs[rel] = rec;
  }
  return recs;
}

// ---------- stage 1.5: entrypoints ----------
function findEntrypoints(files: Record<string, FileRec>): string[] {
  const eps = new Set<string>();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const add = (v: unknown) => {
      if (typeof v === "string") {
        const norm = v.replace(/^\.\//, "");
        if (files[norm]) eps.add(norm);
      }
    };
    add(pkg.main);
    add(pkg.module);
    if (pkg.bin) Object.values(pkg.bin).forEach(add);
    if (pkg.exports) JSON.stringify(pkg.exports).match(/\.\/[^"']+/g)?.forEach((s) => add(s.replace(/^\.\//, "")));
  } catch {
    /* no pkg */
  }
  for (const rel of Object.keys(files)) {
    if (/(^|\/)(index|main|cli|server|app|__main__)\.[a-z]+$/i.test(rel)) eps.add(rel);
    // standalone runnable files are roots, not dead library code
    if (/(^|\/)(benchmarks?|examples?|demos?|scripts?|bin)(\/|$)/i.test(rel)) eps.add(rel);
    if (files[rel].kind === "test") eps.add(rel);
    if (files[rel].shebang) eps.add(rel);
  }
  return [...eps];
}

// ---------- stage 4: signals ----------
function deadCode(g: Graph): string[] {
  const inbound = new Map<string, number>();
  for (const f of Object.values(g.files)) for (const imp of f.imports) inbound.set(imp, (inbound.get(imp) || 0) + 1);
  const ep = new Set(g.entrypoints);
  // dead = an importable unit (has exports) that no one imports and isn't an entrypoint.
  // files with no exports + no inbound are standalone scripts, not dead library code.
  return Object.values(g.files)
    .filter((f) => f.kind === "source" && !ep.has(f.rel) && f.exports.length > 0 && !((inbound.get(f.rel) || 0) > 0))
    .map((f) => f.rel)
    .sort();
}

function cycles(g: Graph): string[][] {
  // Tarjan SCC over import edges; report SCCs of size>1
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sccs: string[][] = [];
  const nodes = Object.keys(g.files);
  const strongconnect = (v: string) => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of g.files[v]?.imports || []) {
      if (!g.files[w]) continue;
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
    }
  };
  for (const v of nodes) if (!idx.has(v)) strongconnect(v);
  return sccs;
}

function untested(g: Graph): string[] {
  const testedBy = new Set<string>();
  for (const f of Object.values(g.files)) if (f.kind === "test") for (const imp of f.imports) testedBy.add(imp);
  const bases = new Set(
    Object.values(g.files)
      .filter((f) => f.kind === "test")
      .map((f) => path.basename(f.rel).replace(/\.(test|spec)\./, ".").replace(/_test\./, ".")),
  );
  const ep = new Set(g.entrypoints);
  // untested = importable unit (has exports) no test imports and no sibling test covers.
  return Object.values(g.files)
    .filter((f) => f.kind === "source" && f.exports.length > 0 && !ep.has(f.rel) && !testedBy.has(f.rel) && !bases.has(path.basename(f.rel)))
    .map((f) => f.rel)
    .sort();
}

function redundancy(g: Graph): { sameBasename: Record<string, string[]>; sameExport: Record<string, string[]> } {
  const byBase: Record<string, string[]> = {};
  const byExport: Record<string, string[]> = {};
  for (const f of Object.values(g.files)) {
    if (f.kind !== "source") continue;
    const b = path.basename(f.rel);
    (byBase[b] ||= []).push(f.rel);
    for (const ex of f.exports) (byExport[ex] ||= []).push(f.rel);
  }
  const filt = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.length > 1));
  const noisy = new Set(["index.ts", "index.js", "default", "handler", "main"]);
  const sameBasename = Object.fromEntries(Object.entries(filt(byBase)).filter(([k]) => !noisy.has(k)));
  const sameExport = Object.fromEntries(Object.entries(filt(byExport)).filter(([k]) => !noisy.has(k) && k.length > 2));
  return { sameBasename, sameExport };
}

// ---------- module aggregation ----------
function moduleOf(rel: string): string {
  const parts = rel.split("/");
  if (parts.length === 1) return ".";
  if (["src", "lib", "app", "packages"].includes(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

// ---------- stage 5: render ----------
const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "_");

function computeSignals(g: Graph) {
  const counts: Record<Kind, number> = { source: 0, test: 0, config: 0, doc: 0, output: 0, other: 0 };
  for (const f of Object.values(g.files)) counts[f.kind]++;
  return { counts, dead: deadCode(g), untested: untested(g), cycles: cycles(g), redundancy: redundancy(g) };
}

function renderPuml(g: Graph, sig: ReturnType<typeof computeSignals>): string {
  const L: string[] = [];
  L.push("@startuml codemap");
  L.push("' generated by codemap — deterministic snapshot, do not hand-edit");
  L.push("skinparam componentStyle rectangle");
  L.push("skinparam shadowing false");
  L.push("skinparam packageStyle rectangle");
  L.push("left to right direction");
  L.push("");
  const deadSet = new Set(sig.dead);
  const untestedSet = new Set(sig.untested);
  const cyclic = new Set(sig.cycles.flat());

  if (detail === "module") {
    const mods = new Map<string, { loc: number; files: number; dead: number; untested: number }>();
    const edges = new Map<string, number>();
    for (const f of Object.values(g.files)) {
      if (f.kind !== "source" && f.kind !== "test") continue;
      const m = moduleOf(f.rel);
      const e = mods.get(m) || { loc: 0, files: 0, dead: 0, untested: 0 };
      e.loc += f.loc;
      e.files++;
      if (deadSet.has(f.rel)) e.dead++;
      if (untestedSet.has(f.rel)) e.untested++;
      mods.set(m, e);
      for (const imp of f.imports) {
        const tm = moduleOf(imp);
        if (tm !== m) edges.set(`${m} ${tm}`, (edges.get(`${m} ${tm}`) || 0) + 1);
      }
    }
    for (const [m, e] of [...mods].sort()) {
      const id = sanitize(m);
      const note = `${e.files}f ${e.loc}loc${e.dead ? ` !${e.dead}dead` : ""}${e.untested ? ` ~${e.untested}untested` : ""}`;
      const color = e.dead ? "#FFD7D7" : e.untested ? "#FFE9CC" : "#E8F0FE";
      L.push(`component "${m}\\n<size:10>${note}</size>" as ${id} ${color}`);
    }
    L.push("");
    for (const [k, n] of [...edges].sort()) {
      const [a, b] = k.split(" ");
      L.push(`${sanitize(a)} --> ${sanitize(b)} : ${n}`);
    }
  } else {
    const groups = new Map<string, FileRec[]>();
    for (const f of Object.values(g.files)) {
      if (f.kind !== "source" && f.kind !== "test") continue;
      const m = moduleOf(f.rel);
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m)!.push(f);
    }
    for (const [m, fl] of [...groups].sort()) {
      L.push(`package "${m}" {`);
      for (const f of fl.sort((a, b) => a.rel.localeCompare(b.rel))) {
        const id = sanitize(f.rel);
        let stereo = "";
        let color = "";
        if (deadSet.has(f.rel)) [stereo, color] = ["<<dead>>", "#FFD7D7"];
        else if (cyclic.has(f.rel)) [stereo, color] = ["<<cycle>>", "#E7D7FF"];
        else if (untestedSet.has(f.rel)) [stereo, color] = ["<<untested>>", "#FFE9CC"];
        else if (f.kind === "test") [stereo, color] = ["<<test>>", "#D7FFD9"];
        L.push(`  [${path.basename(f.rel)}] as ${id} ${stereo} ${color}`.trimEnd());
      }
      L.push("}");
    }
    L.push("");
    for (const f of Object.values(g.files)) for (const imp of f.imports) if (g.files[imp]) L.push(`${sanitize(f.rel)} --> ${sanitize(imp)}`);
  }

  if (includeExternal) {
    const ext = new Map<string, number>();
    for (const f of Object.values(g.files)) for (const e of f.externals) ext.set(e, (ext.get(e) || 0) + 1);
    L.push("");
    for (const [e, n] of [...ext].sort((a, b) => b[1] - a[1]).slice(0, 15)) L.push(`cloud "${e}\\n<size:9>${n}x</size>" as ext_${sanitize(e)}`);
  }

  L.push("");
  L.push("legend right");
  L.push("  == codemap snapshot ==");
  L.push(`  ecosystems: ${g.ecosystems.join(", ")}`);
  L.push(`  source: ${sig.counts.source} | tests: ${sig.counts.test} | docs: ${sig.counts.doc}`);
  L.push(`  dead (no inbound, not entrypoint): ${sig.dead.length}`);
  L.push(`  untested source: ${sig.untested.length}`);
  L.push(`  import cycles: ${sig.cycles.length}`);
  L.push(`  config files: ${sig.counts.config}`);
  L.push("  --");
  L.push("  red=dead  orange=untested  purple=cycle  green=test");
  L.push("endlegend");
  L.push("@enduml");
  return L.join("\n");
}

function renderMd(g: Graph, sig: ReturnType<typeof computeSignals>, ts: string): string {
  const seams = new Map<string, number>();
  for (const f of Object.values(g.files)) {
    if (f.kind !== "source") continue;
    const m = moduleOf(f.rel);
    for (const imp of f.imports) {
      const tm = moduleOf(imp);
      if (tm !== m) seams.set(`${m} -> ${tm}`, (seams.get(`${m} -> ${tm}`) || 0) + 1);
    }
  }
  const ext = new Map<string, number>();
  for (const f of Object.values(g.files)) for (const e of f.externals) ext.set(e, (ext.get(e) || 0) + 1);
  const docs = Object.values(g.files).filter((f) => f.kind === "doc" && f.frontmatter);
  const configs = Object.values(g.files)
    .filter((f) => f.kind === "config")
    .map((f) => f.rel)
    .sort();
  const outputs = [...new Set(Object.values(g.files).filter((f) => f.kind === "output").map((f) => moduleOf(f.rel)))].sort();
  const moduleLoc = new Map<string, number>();
  for (const f of Object.values(g.files)) if (f.kind === "source") moduleLoc.set(moduleOf(f.rel), (moduleLoc.get(moduleOf(f.rel)) || 0) + f.loc);

  const L: string[] = [];
  L.push("---");
  L.push(`generated: ${ts}`);
  L.push(`project: ${path.basename(g.root)}`);
  L.push(`ecosystems: [${g.ecosystems.join(", ")}]`);
  L.push(`source_files: ${sig.counts.source}`);
  L.push(`test_files: ${sig.counts.test}`);
  L.push(`dead_count: ${sig.dead.length}`);
  L.push(`untested_count: ${sig.untested.length}`);
  L.push(`cycle_count: ${sig.cycles.length}`);
  L.push("tool: codemap");
  L.push("---");
  L.push("");
  L.push(`# Codemap — ${path.basename(g.root)}`);
  L.push("");
  L.push("> Deterministic static snapshot (no LLM). Re-run after changes and diff `codemap.json` to see what moved.");
  L.push("");
  L.push("## Module shapes (LOC by module)");
  L.push("");
  for (const [m, loc] of [...moduleLoc].sort((a, b) => b[1] - a[1]).slice(0, 25)) L.push(`- \`${m}\` — ${loc} LOC`);
  L.push("");
  L.push("## Seams (cross-module import edges)");
  L.push("");
  if (seams.size === 0) L.push("_none detected_");
  for (const [s, n] of [...seams].sort((a, b) => b[1] - a[1]).slice(0, 40)) L.push(`- ${s} — ${n}`);
  L.push("");
  L.push(`## Dead code candidates (${sig.dead.length})`);
  L.push("");
  L.push("_Source files with no inbound import and not an entrypoint. Verify before deleting — dynamic/CLI/plugin loads aren't seen._");
  L.push("");
  for (const d of sig.dead.slice(0, 80)) L.push(`- \`${d}\``);
  if (sig.dead.length > 80) L.push(`- … +${sig.dead.length - 80} more`);
  L.push("");
  L.push(`## Untested source (${sig.untested.length})`);
  L.push("");
  L.push("_No test file imports it and no sibling test exists. Heuristic — wire up coverage for precision._");
  L.push("");
  for (const u of sig.untested.slice(0, 80)) L.push(`- \`${u}\``);
  if (sig.untested.length > 80) L.push(`- … +${sig.untested.length - 80} more`);
  L.push("");
  L.push(`## Import cycles (${sig.cycles.length})`);
  L.push("");
  for (const c of sig.cycles.slice(0, 20)) L.push(`- ${c.map((x) => `\`${x}\``).join(" <-> ")}`);
  if (!sig.cycles.length) L.push("_none detected_");
  L.push("");
  L.push("## Possible redundancy");
  L.push("");
  const sb = Object.entries(sig.redundancy.sameBasename);
  const se = Object.entries(sig.redundancy.sameExport);
  if (sb.length) {
    L.push("**Same filename in multiple dirs:**");
    for (const [k, v] of sb.slice(0, 20)) L.push(`- \`${k}\` → ${v.map((x) => `\`${x}\``).join(", ")}`);
    L.push("");
  }
  if (se.length) {
    L.push("**Same exported symbol from multiple files:**");
    for (const [k, v] of se.slice(0, 20)) L.push(`- \`${k}\` → ${v.map((x) => `\`${x}\``).join(", ")}`);
    L.push("");
  }
  if (!sb.length && !se.length) L.push("_none detected_");
  L.push("");
  L.push(`## Config files (${configs.length})`);
  L.push("");
  for (const c of configs) L.push(`- \`${c}\``);
  L.push("");
  L.push("## Top external deps");
  L.push("");
  for (const [e, n] of [...ext].sort((a, b) => b[1] - a[1]).slice(0, 25)) L.push(`- \`${e}\` — ${n} imports`);
  L.push("");
  L.push(`## Docs with frontmatter (${docs.length})`);
  L.push("");
  for (const d of docs.slice(0, 40)) {
    const fmKeys = Object.entries(d.frontmatter!)
      .slice(0, 4)
      .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
      .join(", ");
    L.push(`- \`${d.rel}\` — ${fmKeys}`);
  }
  L.push("");
  if (outputs.length) {
    L.push("## Output / log dirs");
    L.push("");
    for (const o of outputs) L.push(`- \`${o}/\``);
    L.push("");
  }
  return L.join("\n");
}

// ---------- diff (commit vs commit / ref vs working tree) ----------
type IR = {
  root?: string;
  ecosystems?: string[];
  counts?: Record<string, number>;
  dead?: string[];
  untested?: string[];
  cycles?: string[][];
  files?: Record<string, { kind: string; loc: number; imports: string[] }>;
};

function seamEdges(ir: IR): Map<string, number> {
  const edges = new Map<string, number>();
  for (const [rel, f] of Object.entries(ir.files || {})) {
    if (f.kind !== "source" && f.kind !== "test") continue;
    const m = moduleOf(rel);
    for (const imp of f.imports || []) {
      const tm = moduleOf(imp);
      if (tm !== m) edges.set(`${m} -> ${tm}`, (edges.get(`${m} -> ${tm}`) || 0) + 1);
    }
  }
  return edges;
}

function setDiff<T>(before: T[], after: T[]): { added: T[]; removed: T[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((x) => !b.has(x)), removed: before.filter((x) => !a.has(x)) };
}

function renderDiff(ref: string, before: IR, after: IR): string {
  const L: string[] = [];
  const fb = new Set(Object.keys(before.files || {}));
  const fa = new Set(Object.keys(after.files || {}));
  const filesAdded = [...fa].filter((x) => !fb.has(x)).sort();
  const filesRemoved = [...fb].filter((x) => !fa.has(x)).sort();
  const dead = setDiff(before.dead || [], after.dead || []);
  const untested = setDiff(before.untested || [], after.untested || []);
  const cyc = setDiff((before.cycles || []).map((c) => c.join(" <-> ")), (after.cycles || []).map((c) => c.join(" <-> ")));
  const eb = seamEdges(before);
  const ea = seamEdges(after);
  const seamKeys = new Set([...eb.keys(), ...ea.keys()]);
  const seamChanges: string[] = [];
  for (const k of [...seamKeys].sort()) {
    const x = eb.get(k) || 0;
    const y = ea.get(k) || 0;
    if (x !== y) seamChanges.push(`${k}: ${x} → ${y}${x === 0 ? " (new seam)" : y === 0 ? " (severed)" : ""}`);
  }

  L.push("---");
  L.push(`comparison: ${ref} → working`);
  L.push(`tool: codemap-diff`);
  L.push("---");
  L.push("");
  L.push(`# Codemap diff — ${ref} → current`);
  L.push("");
  L.push("> Structural delta only (modules, seams, signals). Run `git diff` for line-level changes.");
  L.push("");
  const sec = (title: string, items: string[], fmt = (s: string) => `\`${s}\``) => {
    L.push(`## ${title} (${items.length})`);
    L.push("");
    if (!items.length) L.push("_none_");
    for (const i of items.slice(0, 60)) L.push(`- ${fmt(i)}`);
    if (items.length > 60) L.push(`- … +${items.length - 60} more`);
    L.push("");
  };
  L.push("## Headline");
  L.push("");
  const d = (a: number, b: number) => (b - a > 0 ? `+${b - a}` : `${b - a}`);
  L.push(`- dead: ${(before.dead || []).length} → ${(after.dead || []).length} (${d((before.dead || []).length, (after.dead || []).length)})`);
  L.push(`- untested: ${(before.untested || []).length} → ${(after.untested || []).length} (${d((before.untested || []).length, (after.untested || []).length)})`);
  L.push(`- cycles: ${(before.cycles || []).length} → ${(after.cycles || []).length} (${d((before.cycles || []).length, (after.cycles || []).length)})`);
  L.push(`- files: ${fb.size} → ${fa.size} (${d(fb.size, fa.size)})`);
  L.push("");
  sec("Files added", filesAdded);
  sec("Files removed", filesRemoved);
  sec("Newly dead (regressions)", dead.added);
  sec("Dead resolved", dead.removed);
  sec("Newly untested (regressions)", untested.added);
  sec("Now tested / removed", untested.removed);
  sec("Cycles introduced", cyc.added, (s) => s);
  sec("Cycles broken", cyc.removed, (s) => s);
  sec("Seam changes", seamChanges, (s) => s);
  return L.join("\n");
}

function runDiff(ref: string, currentIR: IR) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-vs-"));
  const tmpOut = path.join(tmp, "_out");
  try {
    const added = sh("git", ["worktree", "add", "--detach", "--force", tmp, ref]);
    if (added === null) {
      log(`--vs: could not create worktree at '${ref}' (not a git repo or bad ref); skipping diff`);
      return;
    }
    const self = fileURLToPath(import.meta.url);
    execFileSync("npx", ["tsx", self, tmp, "--out", tmpOut, "--detail", detail], { stdio: "ignore" });
    const refIR: IR = JSON.parse(fs.readFileSync(path.join(tmpOut, "codemap.json"), "utf8"));
    const diff = renderDiff(ref, refIR, currentIR);
    fs.writeFileSync(path.join(outDir, "codemap.diff.md"), diff);
    log(`wrote ${path.relative(root, outDir) || "."}/codemap.diff.md (${ref} → working)`);
  } finally {
    sh("git", ["worktree", "remove", "--force", tmp]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- main ----------
function isoStamp(): string {
  const head = sh("git", ["rev-parse", "--short", "HEAD"]);
  const d = new Date();
  return `${d.toISOString()}${head ? ` @${head.trim()}` : ""}`;
}

function main() {
  log(`root=${root}`);
  const ecosystems = detect();
  log(`ecosystems: ${ecosystems.join(", ")}`);
  const allRel = listFiles();
  log(`files: ${allRel.length}`);
  const files = inventory(allRel);
  const g: Graph = { root, ecosystems, files, entrypoints: [] };
  g.entrypoints = findEntrypoints(files);
  log(`entrypoints: ${g.entrypoints.length}`);
  const sig = computeSignals(g);
  log(`dead=${sig.dead.length} untested=${sig.untested.length} cycles=${sig.cycles.length}`);

  fs.mkdirSync(outDir, { recursive: true });
  // preserve prior run so `before vs after` is a plain JSON diff
  const jsonPath = path.join(outDir, "codemap.json");
  if (fs.existsSync(jsonPath)) {
    try {
      fs.copyFileSync(jsonPath, path.join(outDir, "prev.json"));
      const prev = JSON.parse(fs.readFileSync(path.join(outDir, "prev.json"), "utf8"));
      const d = (a: number, b: number) => (b - a >= 0 ? `+${b - a}` : `${b - a}`);
      log(
        `Δ vs prev: dead ${d(prev.dead?.length || 0, sig.dead.length)} | untested ${d(prev.untested?.length || 0, sig.untested.length)} | cycles ${d(prev.cycles?.length || 0, sig.cycles.length)}`,
      );
    } catch {
      /* ignore */
    }
  }
  const ts = isoStamp();
  const ir = {
    generated: ts,
    root,
    ecosystems,
    counts: sig.counts,
    entrypoints: g.entrypoints,
    dead: sig.dead,
    untested: sig.untested,
    cycles: sig.cycles,
    redundancy: sig.redundancy,
    files: Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, { kind: v.kind, loc: v.loc, lang: v.lang, imports: v.imports, externals: v.externals }]),
    ),
  };
  fs.writeFileSync(path.join(outDir, "codemap.puml"), renderPuml(g, sig));
  fs.writeFileSync(path.join(outDir, "codemap.md"), renderMd(g, sig, ts));
  fs.writeFileSync(path.join(outDir, "codemap.json"), JSON.stringify(ir, null, 2));
  log(`wrote ${path.relative(root, outDir) || "."}/{codemap.puml,codemap.md,codemap.json}`);

  const vs = flag("vs");
  if (vs) runDiff(vs, ir as IR);

  process.stdout.write(`${path.join(outDir, "codemap.md")}\n`);
}

main();
