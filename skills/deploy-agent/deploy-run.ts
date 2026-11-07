// deploy-run.ts — Deploy Agent: runs an operator-accepted card's pinned script as root.
//   bun deploy-run.ts <card-id> [--repo R] [--dry]   exit = script's code (0 with --dry), 3 = refused (one-line reason)
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDecision, repoDir } from "../human-gate-post-webui/decide";

export const QUEUE = join(homedir(), "vault", "director", "deploy-queue");
const FENCES = join(dirname(import.meta.path), "fences.txt");

export class Refuse extends Error {}
const refuse = (why: string): never => { throw new Refuse(why); };

export type Deps = {
  bd: (dir: string, ...args: string[]) => string;
  readFile: (p: string) => string;
  queueDir: string;
  fencesFile: string;
  exec: (text: string) => number;
  logChange: (line: string) => void;
};

function realBd(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(["bd", "-C", dir, ...args], { stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`bd ${args[0]}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

export const realDeps = (): Deps => ({
  bd: realBd,
  readFile: (p) => readFileSync(p, "utf8"),
  queueDir: QUEUE,
  fencesFile: FENCES,
  // Runs the hashed bytes via stdin, never the path: the queue dir is agent-writable (no swap after the check).
  exec: (text) => Bun.spawnSync(["sudo", "-n", "bash", "-s"], { stdin: Buffer.from(text), stdout: "inherit", stderr: "inherit" }).exitCode ?? 1,
  logChange: (line) => {
    const wk = Bun.spawnSync(["date", "-u", "+%G-W%V"]).stdout.toString().trim();
    const f = join(homedir(), "vault", "director", "changes", `${wk}.md`);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, line);
  },
});

export function plan(id: string, repo: string | undefined, d: Deps) {
  const dir = repoDir(repo);
  const card = JSON.parse(d.bd(dir, "show", id, "--json") || "null");
  const c = Array.isArray(card) ? card[0] : card;
  if (!c) refuse(`card ${id} not found`);
  const comments = (c.comments ?? JSON.parse(d.bd(dir, "comments", id, "--json") || "[]")) as { author?: string; text: string }[];
  const decided = comments.filter((x) => parseDecision(x.text)).at(-1);
  if (!decided) refuse("no DECISION comment");
  const last = parseDecision(decided!.text)!;
  if (last.verb !== "accept") refuse(`last decision is ${last.verb}, not accept`);
  // ponytail: the author field is forgeable by any agent; operator chose fences-only trust (repos-vlqa C). Upgrade: webui-signed accepts.
  if (decided!.author !== "operator") refuse(`decision author is ${decided!.author ?? "unknown"}, not operator`);

  const m = /^Run: (\S+) sha256: ([0-9a-f]{64})\s*$/m.exec(c.description ?? "");
  if (!m) return refuse("no 'Run: <path> sha256: <hex>' line in card");
  const path = resolve(m[1]!), hex = m[2]!;
  if (!path.startsWith(resolve(d.queueDir) + "/")) refuse(`script not under ${d.queueDir}`);
  const text = d.readFile(path);
  if (createHash("sha256").update(text).digest("hex") !== hex) refuse("sha256 mismatch");
  const undo = /^#\s*undo:\s*(\S.*)$/m.exec(text)?.[1];
  if (!undo) refuse("script has no '# undo: <cmd>' line");
  for (const line of d.readFile(d.fencesFile).split("\n").filter((l) => l.trim())) {
    if (new RegExp(line).test(text)) refuse(`fenced: matches /${line}/`);
  }
  return { id, path, undo: undo!, hex, text };
}

export function main(argv: string[], d: Deps, out: (s: string) => void = console.log): number {
  const ri = argv.indexOf("--repo");
  const id = argv.find((a, i) => !a.startsWith("-") && (ri < 0 || i !== ri + 1));
  try {
    if (!id) refuse("usage: deploy-run.ts <card-id> [--repo R]");
    const p = plan(id!, ri >= 0 ? argv[ri + 1] : undefined, d)!;
    if (argv.includes("--dry")) {
      out(`DRY RUN\nscript: ${p.path}\nhash: ok ${p.hex.slice(0, 12)}\nundo: ${p.undo}\nfence: clear`);
      return 0;
    }
    const code = d.exec(p.text);
    d.logChange(`\n## ${new Date().toISOString()}\n- what: ran ${p.path} as root (exit ${code})\n- card: ${p.id}\n- undo: ${p.undo}\n`);
    return code;
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    console.error(`REFUSED: ${e.message}`);
    return 3;
  }
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2), realDeps()));
