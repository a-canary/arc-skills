#!/usr/bin/env bun
// ontology-check — deterministic staleness classifier for map-ontology docs.
// Shared module: classify() is imported by the hygiene drift collector;
// this file's main guard is the `ontology-check <root>` CLI entry point.
//
// A doc is FRESH when, against live reality:
//   1. every machine-checkable claim holds (paths exist, cron lines present, aliases resolve)
//   2. git diff --name-only <surveyed_at_sha>..HEAD -- <scope> is empty
//      (docs/ontology/** excluded — a map editing itself does not go stale)
// Missing scope = whole repo (fail-closed). Checker error = stale (fail-closed).
// Exit: 0 fresh, 1 stale. No LLM.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ClaimResult {
  claim: string;
  ok: boolean;
  detail?: string;
}

export interface DocReport {
  file: string; // relative to root
  verdict: "fresh" | "stale" | "error";
  claims: ClaimResult[];
  changedFiles: string[]; // scoped diff since surveyed_at_sha, ontology dir excluded
  errors: string[];
}

export interface CheckResult {
  fresh: boolean;
  docs: DocReport[];
}

export interface Options {
  crontab?: string; // raw crontab text (default: `crontab -l`)
  aliases?: string; // llm-proxy switchboard JSON text (default: ~/repos/arc-llm-proxy/deploy/switchboard.local.json)
}

const ONTOLOGY_DIR = "docs/ontology/";
// Backticked token that looks like a filesystem path: has a slash, no spaces,
// no scheme, no globs, must end in a filename char (trailing-slash dir refs
// are NOT claims — they'd false-stale on untracked dirs). Deliberately strict;
// ponytail: only backtick real paths in ontology docs (documented in SKILL.md).
const PATH_RE = /^[~/]?[A-Za-z0-9_.\-]+(\/[A-Za-z0-9_.\-]+)+$/;

interface Frontmatter {
  surveyed_at_sha?: string;
  scope: string[] | null; // null = absent (fail-closed whole repo)
  status?: string;
}

function parseFrontmatter(text: string): { fm: Frontmatter; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: { scope: null }, body: text };
  const raw = m[1];
  const body = text.slice(m[0].length);
  const fm: Frontmatter = { scope: null };
  let inScope = false;
  for (const line of raw.split("\n")) {
    if (inScope) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) fm.scope!.push(item[1].trim());
      else inScope = false;
      continue;
    }
    let kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === "surveyed_at_sha") fm.surveyed_at_sha = v.trim();
    else if (k === "status") fm.status = v.trim();
    else if (k === "scope") {
      const inline = v.match(/^\[(.*)\]$/);
      if (inline) fm.scope = inline[1] ? inline[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
      else {
        fm.scope = [];
        inScope = true;
      }
    }
  }
  return { fm, body };
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Extract + verify machine-checkable claims from a doc body. */
export function checkClaims(
  body: string,
  root: string,
  opts: { crontab: string; aliases: string },
): ClaimResult[] {
  const out: ClaimResult[] = [];
  let cfg: { default_alias?: string; aliases?: Record<string, unknown> } = {};
  try {
    cfg = JSON.parse(opts.aliases);
  } catch {
    /* alias claims will report the parse failure */
  }
  for (const span of body.matchAll(/`([^`\n]+)`/g)) {
    const tok = span[1].trim();
    if (tok.startsWith("cron:")) {
      // `cron: <5-field schedule> <command fragment>`
      const parts = tok.slice(5).trim().split(/\s+/);
      const sched = parts.slice(0, 5).join(" ");
      const frag = parts.slice(5).join(" ");
      const line = opts.crontab
        .split("\n")
        .find((l) => !l.trim().startsWith("#") && l.split(/\s+/).slice(0, 5).join(" ") === sched && (!frag || l.includes(frag)));
      out.push({ claim: tok, ok: !!line, detail: line ? undefined : "no matching crontab line" });
    } else if (tok.startsWith("alias:")) {
      const name = tok.slice(6).trim();
      const known = cfg.aliases && name in cfg.aliases;
      const isDefault = cfg.default_alias === name;
      out.push({
        claim: tok,
        ok: !!(known || isDefault),
        detail: known || isDefault ? undefined : "alias not in llm-proxy switchboard",
      });
    } else if (PATH_RE.test(tok) && !tok.includes("://")) {
      const abs = resolve(root, expandHome(tok));
      const ok = existsSync(abs);
      out.push({ claim: tok, ok, detail: ok ? undefined : "path does not exist" });
    }
  }
  return out;
}

function scopedDiff(root: string, fromSha: string, scope: string[]): string[] {
  const args = ["diff", "--name-only", `${fromSha}..HEAD`, "--", ...scope];
  const out = execSync(`git ${args.map((a) => `"${a}"`).join(" ")}`, { cwd: root, stdio: "pipe" }).toString();
  return out
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.startsWith(ONTOLOGY_DIR)); // self-update exclusion
}

export function classify(root: string, opts: Options = {}): CheckResult {
  const crontab = opts.crontab ?? safeCrontab();
  // arc-proxy aliases live in the llm-proxy switchboard (deploy/switchboard.local.json)
  const aliasesPath = join(homedir(), "repos/arc-llm-proxy/deploy/switchboard.local.json");
  const aliases = opts.aliases ?? (existsSync(aliasesPath) ? readFileSync(aliasesPath, "utf8") : "{}");
  const dir = join(root, "docs", "ontology");
  if (!existsSync(dir)) return { fresh: true, docs: [] };

  const docs: DocReport[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const file = join("docs/ontology", f);
    const report: DocReport = { file, verdict: "fresh", claims: [], changedFiles: [], errors: [] };
    try {
      const { fm, body } = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      report.claims = checkClaims(body, root, { crontab, aliases });
      if (!fm.surveyed_at_sha) {
        report.errors.push("missing surveyed_at_sha");
      } else {
        try {
          execSync(`git rev-parse --verify ${fm.surveyed_at_sha}^{commit}`, { cwd: root, stdio: "pipe" });
          const scope = fm.scope === null ? ["."] : fm.scope; // missing scope = whole repo
          report.changedFiles = scopedDiff(root, fm.surveyed_at_sha, scope);
        } catch {
          report.errors.push(`surveyed_at_sha ${fm.surveyed_at_sha} does not resolve`);
        }
      }
    } catch (e) {
      report.errors.push(String(e));
    }
    const broken = report.claims.filter((c) => !c.ok);
    report.verdict =
      report.errors.length > 0 ? "error" : broken.length > 0 || report.changedFiles.length > 0 ? "stale" : "fresh";
    docs.push(report);
  }
  return { fresh: docs.every((d) => d.verdict === "fresh"), docs };
}

function safeCrontab(): string {
  try {
    return execSync("crontab -l", { stdio: ["pipe", "pipe", "pipe"] }).toString();
  } catch {
    return ""; // no crontab — cron claims will report missing
  }
}

/** CLI entry. Returns process exit code (0 fresh / 1 stale). */
export function run(argv: string[], opts: Options = {}): number {
  const root = resolve(argv[0] ?? ".");
  const res = classify(root, opts);
  if (res.docs.length === 0) {
    console.log(`ontology-check: no docs/ontology/ in ${root} — nothing to check (fresh)`);
    return 0;
  }
  for (const d of res.docs) {
    const tag = d.verdict.toUpperCase().padEnd(5);
    console.log(`${tag} ${d.file}`);
    for (const c of d.claims.filter((c) => !c.ok)) console.log(`       broken claim: \`${c.claim}\` — ${c.detail}`);
    for (const f of d.changedFiles) console.log(`       changed in scope: ${f}`);
    for (const e of d.errors) console.log(`       error (fail-closed): ${e}`);
  }
  console.log(res.fresh ? "ontology-check: FRESH" : "ontology-check: STALE");
  return res.fresh ? 0 : 1;
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2)));
}
