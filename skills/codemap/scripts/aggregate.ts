#!/usr/bin/env tsx
/**
 * codemap aggregator (PROTOTYPE)
 *
 * Detects which language ecosystems a repo contains, then for each one runs
 * the mature, AST-based analysis tool for that language — IF it's installed —
 * and normalizes the findings into one report + JSON IR.
 *
 * Philosophy: codemap's own regex graph is weaker than knip/madge/vulture/etc.
 * So don't reimplement them — shell out. We DO NOT auto-install: installing
 * global/network packages on the user's machine is an outward side effect with
 * version + sudo surprises. Instead we degrade loudly: "N <lang> files, tool
 * <x> missing, install with <cmd>".
 *
 * Usage: npx tsx aggregate.ts <project-dir> [--out DIR]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Lang = "js/ts" | "python" | "go" | "rust";
interface Finding { tool: string; kind: string; loc: string; detail: string }
/** processed === 0 means the tool ran but analyzed nothing (bad config / wrong
 *  extensions) — must NOT be reported as a clean "0 findings". */
interface RunResult { findings: Finding[]; processed?: number; note?: string }
interface Adapter {
  id: string; // binary name probed on PATH
  lang: Lang;
  finds: string; // human description of what it surfaces
  install: string; // install hint shown when missing
  run: (root: string, srcDirs: string[], files: string[]) => RunResult;
}

const EXT_LANG: Record<string, Lang> = {
  ".ts": "js/ts", ".tsx": "js/ts", ".js": "js/ts", ".jsx": "js/ts", ".mjs": "js/ts", ".cjs": "js/ts",
  ".py": "python", ".go": "go", ".rs": "rust",
};

const root = path.resolve(process.argv[2] || ".");
const outDir = path.resolve(getFlag("out") || path.join(root, "codemap"));

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** run a command, return stdout/stderr/code WITHOUT throwing (many of these
 *  tools exit non-zero precisely when they find something). */
function sh(cmd: string, cwd = root): { code: number; out: string; err: string } {
  try {
    const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out, err: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, out: e.stdout?.toString() ?? "", err: e.stderr?.toString() ?? "" };
  }
}

function probe(tool: string): string | null {
  const w = sh(`command -v ${tool}`);
  if (w.code !== 0 || !w.out.trim()) return null;
  const v = sh(`${tool} --version`);
  return (v.out || "(installed)").trim().split("\n")[0];
}

function listFiles(): string[] {
  const g = sh("git ls-files --cached --others --exclude-standard");
  if (g.code === 0 && g.out.trim()) return g.out.trim().split("\n");
  // fallback walk
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", "coverage", "__pycache__", ".venv", "target", ".next"]);
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(root, p));
    }
  })(root);
  return out;
}

/** top-level source dirs to point tools at; falls back to root. */
function sourceDirs(files: string[]): string[] {
  const cand = ["src", "lib", "app", "apps", "packages"];
  const present = cand.filter((c) => fs.existsSync(path.join(root, c)));
  if (present.length) return present;
  // any source file at root level?
  return ["."];
}

// ---------- adapters ----------
const ADAPTERS: Adapter[] = [
  {
    id: "madge", lang: "js/ts", finds: "import cycles + orphan modules",
    install: "npm i -g madge",
    run: (root, dirs) => {
      // madge's DEFAULT extensions exclude .ts → it silently processes 0 files
      // and reports "no cycles". Always pass extensions; pass tsconfig (for path
      // aliases) when present.
      const ext = "--extensions ts,tsx,js,jsx,mjs,cjs";
      const tscfg = ["tsconfig.json", "tsconfig.base.json"].find((t) => fs.existsSync(path.join(root, t)));
      const tsArg = tscfg ? `--ts-config ${tscfg}` : "";
      const args = `${ext} ${tsArg} ${dirs.join(" ")}`;
      const f: Finding[] = [];
      // file count = keys in the full dep graph
      const graph = sh(`madge --json ${args}`, root);
      let processed = 0;
      try { processed = Object.keys(JSON.parse(graph.out || "{}")).length; } catch { /* */ }
      const cyc = sh(`madge --circular --json ${args}`, root);
      try {
        const j = JSON.parse(cyc.out || "[]");
        const arr: string[][] = Array.isArray(j) ? j : Object.values(j);
        for (const c of arr) if (Array.isArray(c) && c.length > 1) f.push({ tool: "madge", kind: "cycle", loc: c[0], detail: c.join(" → ") });
      } catch { /* */ }
      const orph = sh(`madge --orphans --json ${args}`, root);
      try {
        const j = JSON.parse(orph.out || "[]");
        // test files & entrypoints are "orphans" only because the runner/bundler
        // loads them, not another module — same exclusion codemap applies.
        const isNoise = (p: string) => /\.(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)(index|main|cli|server|app)\.[jt]sx?$/.test(p) || /(^|\/)(scripts?|bin|stories|e2e|__mocks__|fixtures?|generated|dist|build)\//.test(p) || /\.(generated|gen)\./.test(p) || /\.d\.ts$/.test(p) || /\.config\.[jt]s$/.test(p);
        for (const o of (Array.isArray(j) ? j : [])) if (!isNoise(String(o))) f.push({ tool: "madge", kind: "orphan", loc: String(o), detail: "no module imports this file" });
      } catch { /* */ }
      const note = processed === 0 ? "analyzed 0 files — wrong dir or unresolved tsconfig; findings unreliable" : undefined;
      return { findings: f, processed, note };
    },
  },
  {
    id: "knip", lang: "js/ts", finds: "unused files / exports / dependencies",
    install: "npm i -g knip  (best with a knip.json; zero-config may need entry hints)",
    run: (root) => {
      const r = sh("knip --reporter json --no-progress", root);
      const f: Finding[] = [];
      try {
        const j = JSON.parse(r.out || "{}");
        for (const file of j.files || []) f.push({ tool: "knip", kind: "unused-file", loc: String(file), detail: "file never imported" });
        for (const iss of j.issues || []) {
          const file = iss.file || "";
          for (const ex of iss.exports || []) f.push({ tool: "knip", kind: "unused-export", loc: file, detail: `export ${ex.name ?? ex}` });
          for (const dep of iss.dependencies || []) f.push({ tool: "knip", kind: "unused-dep", loc: "package.json", detail: String(dep.name ?? dep) });
        }
      } catch { /* needs config / errored */ }
      return { findings: f };
    },
  },
  {
    id: "vulture", lang: "python", finds: "dead code (unused funcs/classes/vars)",
    install: "pipx install vulture",
    run: (root, _dirs, files) => {
      // vulture ignores .gitignore and would scan nested worktrees / archived
      // dirs — so feed it the git-tracked .py files explicitly.
      const py = files.filter((p) => p.endsWith(".py"));
      if (!py.length) return { findings: [], processed: 0 };
      const f: Finding[] = [];
      // chunk to stay under ARG_MAX on big repos
      const re = /^(.+?):(\d+):\s*(.+?)\s*\((\d+)% confidence/;
      for (let i = 0; i < py.length; i += 400) {
        const chunk = py.slice(i, i + 400).map((p) => `'${p}'`).join(" ");
        const r = sh(`vulture ${chunk} --min-confidence 80`, root);
        for (const line of (r.out || "").split("\n")) {
          const m = line.match(re);
          if (m) f.push({ tool: "vulture", kind: "dead-code", loc: `${m[1]}:${m[2]}`, detail: `${m[3]} (${m[4]}%)` });
        }
      }
      return { findings: f, processed: py.length };
    },
  },
  {
    id: "pydeps", lang: "python", finds: "import graph + cycles",
    install: "pipx install pydeps  (needs graphviz for images; JSON works without)",
    run: (root, dirs) => {
      const f: Finding[] = [];
      const target = dirs.find((d) => d !== ".") || ".";
      const r = sh(`pydeps ${target} --show-cycles --no-output --no-show`, root);
      // pydeps prints cycles as "a -> b -> a" lines on stderr/stdout when present
      for (const line of `${r.out}\n${r.err}`.split("\n")) {
        if (/->.*->/.test(line) && /\b(\w+)\b.*->.*\b\1\b/.test(line)) f.push({ tool: "pydeps", kind: "cycle", loc: line.trim().split("->")[0].trim(), detail: line.trim() });
      }
      return { findings: f };
    },
  },
  {
    id: "jscpd", lang: "js/ts", finds: "copy-paste / duplicated blocks",
    install: "npm i -g jscpd",
    run: (root, dirs) => {
      const f: Finding[] = [];
      const tmp = path.join(outDir, ".jscpd.json");
      sh(`jscpd ${dirs.join(" ")} --silent --reporters json --output ${path.dirname(tmp)}`, root);
      const rep = path.join(path.dirname(tmp), "jscpd-report.json");
      if (fs.existsSync(rep)) {
        try {
          const j = JSON.parse(fs.readFileSync(rep, "utf8"));
          for (const d of j.duplicates || []) f.push({ tool: "jscpd", kind: "clone", loc: `${d.firstFile?.name}:${d.firstFile?.start}`, detail: `${d.lines} lines ↔ ${d.secondFile?.name}` });
        } catch { /* */ }
      }
      return { findings: f };
    },
  },
];

// ---------- main ----------
const files = listFiles();
const counts: Record<string, number> = {};
for (const fpath of files) {
  const l = EXT_LANG[path.extname(fpath)];
  if (l) counts[l] = (counts[l] || 0) + 1;
}
const present = new Set(Object.keys(counts));
const dirs = sourceDirs(files);

const L: string[] = [];
const allFindings: Finding[] = [];
const tooling: { lang: string; tool: string; finds: string; status: string; install: string }[] = [];

L.push(`# Codemap Aggregator — ${path.basename(root)}`);
L.push("");
L.push("> PROTOTYPE. Runs installed best-in-class analyzers per language; warns (never installs) when one is missing.");
L.push("");
L.push("## Ecosystems detected");
L.push("");
for (const [lang, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) L.push(`- **${lang}** — ${n} files`);
L.push("");

L.push("## Tools");
L.push("");
for (const a of ADAPTERS) {
  if (!present.has(a.lang)) continue; // language not in this repo → skip silently
  const ver = probe(a.id);
  if (ver) {
    const res = a.run(root, dirs, files);
    allFindings.push(...res.findings);
    const proc = res.processed !== undefined ? `, ${res.processed} files analyzed` : "";
    if (res.note) {
      tooling.push({ lang: a.lang, tool: a.id, finds: a.finds, status: `DEGRADED: ${res.note}`, install: "" });
      L.push(`- ⚠ \`${a.id}\` ${ver} — ${a.finds} → **ran but ${res.note}**`);
    } else {
      tooling.push({ lang: a.lang, tool: a.id, finds: a.finds, status: `ran (${res.findings.length} findings${proc})`, install: "" });
      L.push(`- ✓ \`${a.id}\` ${ver} — ${a.finds} → **${res.findings.length} findings**${proc}`);
    }
  } else {
    tooling.push({ lang: a.lang, tool: a.id, finds: a.finds, status: "MISSING", install: a.install });
    L.push(`- ✗ \`${a.id}\` — ${a.finds}. **${counts[a.lang]} ${a.lang} files but tool not installed.** install: \`${a.install}\``);
  }
}
L.push("");

const byKind: Record<string, Finding[]> = {};
for (const f of allFindings) (byKind[`${f.tool}:${f.kind}`] ||= []).push(f);
L.push(`## Findings (${allFindings.length})`);
L.push("");
if (!allFindings.length) L.push("_No analyzers ran, or none reported anything. Install the tools above to populate this._");
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  L.push(`### ${k} (${v.length})`);
  for (const f of v.slice(0, 40)) L.push(`- \`${f.loc}\` — ${f.detail}`);
  if (v.length > 40) L.push(`- … +${v.length - 40} more`);
  L.push("");
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "aggregate.md"), L.join("\n"));
fs.writeFileSync(path.join(outDir, "aggregate.json"), JSON.stringify({ root, counts, tooling, findings: allFindings }, null, 2));
process.stdout.write(`${path.join(outDir, "aggregate.md")}\n`);
for (const line of L) process.stderr.write(`${line}\n`);
