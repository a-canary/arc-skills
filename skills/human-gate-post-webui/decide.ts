// decide.ts — the one way an agent asks the operator anything (SKILL.md).
// Builds a <decide> card, lints it, files it as a `human` bead /decide shows, and reads the answers back.
//   bun decide.ts ask  --title T --q "…?" --opt "Title | gain, cost" --opt … [common]   first --opt is the recommendation
//   bun decide.ts task --title T --do "rotate the M1 password" [common]                   → "Will you … today?" Done / Not now
//   bun decide.ts text --title T --q "Which repo holds the spec?" --default "skip the spec check" [common]  → typed answer in the reply note
//   bun decide.ts answers [--repo R] [--json]                                              answered cards, one line each
//   bun decide.ts done <id> --reason "what you did" [--repo R]                            clear `decided`, close the gate
// common: --context C --evidence E --latency L --meanwhile M --repo R -p 0-3 --blocks <your-bead> --replaces <old-gate> --dry --run <script>   (pin a root script for the Deploy Agent; see skills/deploy-agent)
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { lintCard } from "./lint-card";

const REPOS = join(homedir(), "repos");
export const QUEUE_DIR = join(homedir(), "vault", "director", "deploy-queue");

// --run <script>: pin the script by sha256 into the deploy queue; deploy-run.ts re-checks the hash before acting.
export function pinRun(script: string, queueDir = process.env.DEPLOY_QUEUE_DIR ?? QUEUE_DIR, copy = true): string {
  const buf = readFileSync(script);
  const hex = createHash("sha256").update(buf).digest("hex");
  const dest = join(queueDir, `${hex.slice(0, 8)}-${basename(script)}`);
  if (copy) { mkdirSync(queueDir, { recursive: true }); copyFileSync(script, dest); }
  return `Run: ${dest} sha256: ${hex}`;
}
type Args = { _: string[]; opt: string[]; [k: string]: string | string[] | boolean };

export function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], opt: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith("-")) { a._.push(k); continue; }
    const key = k.replace(/^-+/, "");
    if (key === "dry" || key === "json") { a[key] = true; continue; }
    const v = argv[++i] ?? "";
    if (key === "opt") a.opt.push(v); else a[key] = v;
  }
  return a;
}

// Card text sits inside XML-ish tags /decide parses with regex: a stray < or " breaks the card.
const clean = (where: string, s: string) => {
  if (/[<>"]/.test(s)) throw new Error(`${where}: no < > or " in card text`);
  return s.trim();
};

export function buildCard(o: { q: string; opts: string[]; context?: string; evidence?: string; latency?: string; meanwhile?: string; replaces?: string }): string {
  if (!o.q.trim()) throw new Error("--q (or --do) is required");
  if (o.opts.length < 2 || o.opts.length > 4) throw new Error(`${o.opts.length} --opt, need 2-4`);
  const opts = o.opts.map((s, i) => {
    const [title, ...rest] = s.split(" | ");
    if (!rest.length) throw new Error(`--opt "${s}": want "Title | gain and cost"`);
    const id = "ABCDE"[i];
    return `<option id="${id}"${i === 0 ? ' rec="1"' : ""} title="${clean(`option ${id} title`, title!)}">${clean(`option ${id}`, rest.join(" | "))}</option>`;
  });
  const ctx = o.context ? `<context>${clean("context", o.context)}</context>` : "";
  const tail = [
    ["Evidence", [o.evidence, o.replaces && `replaces ${o.replaces}`].filter(Boolean).join("; ")],
    ["Latency", o.latency], ["Meanwhile", o.meanwhile],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return `<decide><q>${clean("q", o.q)}</q>${ctx}${opts.join("")}</decide>\n${tail.length ? "\n" + tail.join("\n") + "\n" : ""}`;
}

export const taskCard = (does: string) => {
  if (!does.trim()) throw new Error("--do is required");
  return {
  q:`Will you ${does.replace(/[.?]+$/, "")} today?`,
  opts: ["Done | It is done; the agent checks and carries on. Costs your time now.", "Not now | Nothing changes today; the work that needs it stays parked."],
  };
};

// A question only a typed answer settles: the operator accepts A and types the answer in the note.
export const textCard = (q: string, fallback: string) => ({
  q,
  opts: ["Answer in note | Accept and type the answer in the note. Costs a minute of typing.", `Skip it | The agent goes ahead and will ${fallback.replace(/[.]+$/, "")}. Risk: a wrong guess.`],
});

// /decide writes "DECISION <verb>[ <opt>][ until <date>][: <note>]" (arc-webui decide.ts).
export function parseDecision(text: string) {
  const m = /^DECISION (accept|reject|reply|refresh|skip|defer)(?: ([A-E]))?(?: until (\S+))?(?::\s*([\s\S]*))?$/.exec(text.trim());
  return m ? { verb: m[1]!, option: m[2] ?? "", until: m[3] ?? "", note: (m[4] ?? "").trim() } : null;
}

// Same dbs /decide scans: ~/repos plus every ~/repos/<name> with its own .beads/embeddeddolt.
export function repoDir(repo?: string): string {
  if (!repo) return REPOS;
  const d = repo.startsWith("/") ? repo : join(REPOS, repo);
  return existsSync(join(d, ".beads", "embeddeddolt")) ? d : REPOS;
}
const allDirs = () => [REPOS, ...readdirSync(REPOS).map((n) => join(REPOS, n)).filter((d) => existsSync(join(d, ".beads", "embeddeddolt")))];

function bd(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(["bd", "-C", dir, ...args], { stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`bd ${args.slice(0, 2).join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

// Option A on task/text cards means "Done" / "Answer in note", never "run it": a pin there would run on a click that meant something else.
const noRun = (a: Args) => { if (a.run) throw new Error("--run only on ask cards; option A there is the run"); };

function ask(a: Args, card: { q: string; opts: string[] }) {
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  const title = s("title");
  if (!title) throw new Error("--title is required: ≤70 plain chars, '<repo>: <the decision>'");
  const base = buildCard({ ...card, context: s("context"), evidence: s("evidence"), latency: s("latency"), meanwhile: s("meanwhile"), replaces: s("replaces") });
  const run = s("run") ? pinRun(s("run")!, undefined, !a.dry) : "";
  const body = run ? `${base}${base.endsWith("\n") ? "" : "\n"}\n${run}\n` : base;
  const err = lintCard(title, body);
  if (err.length) throw new Error(err.map((e) => `card: ${e}`).join("\n"));
  if (a.dry) return console.log(`${title}\n${body}`);
  const dir = repoDir(s("repo")), f = join(tmpdir(), `decide-${process.pid}.md`);
  writeFileSync(f, body);
  const id = JSON.parse(bd(dir, "create", title, "-p", s("p") ?? "2", "-t", "decision", "-l", "human", "--body-file", f, "--json")).id as string;
  console.log(id); // printed first: the card is live even if a link below fails
  const link = (what: string, ...args: string[]) => { try { bd(dir, ...args); } catch (e) { console.error(`${id} posted, but ${what} failed: ${(e as Error).message}`); } };
  if (s("blocks")) link(`dep ${s("blocks")} → ${id}`, "dep", "add", s("blocks")!, id);
  if (s("replaces")) link(`closing ${s("replaces")}`, "close", s("replaces")!, "--reason", `replaced by ${id}`);
}

function answers(a: Args) {
  const rows = [];
  for (const dir of typeof a.repo === "string" ? [repoDir(a.repo)] : allDirs()) {
    for (const b of JSON.parse(bd(dir, "list", "--label", "decided", "--json") || "[]")) {
      const last = (JSON.parse(bd(dir, "comments", b.id, "--json") || "[]") as { text: string }[])
        .map((c) => parseDecision(c.text)).filter(Boolean).at(-1);
      if (!last) continue;
      const title = new RegExp(`<option id="${last.option}"[^>]*title="([^"]*)"`).exec(b.description ?? "")?.[1] ?? "";
      rows.push({ id: b.id, dir, title: b.title, ...last, optionTitle: title });
    }
  }
  if (a.json) return console.log(JSON.stringify(rows, null, 2));
  for (const r of rows) console.log(`${r.id}  ${r.verb}${r.option ? ` ${r.option}${r.optionTitle ? ` (${r.optionTitle})` : ""}` : ""}${r.note ? `: ${r.note}` : ""}  — ${r.title}`);
}

if (import.meta.main) {
  const a = parseArgs(Bun.argv.slice(2));
  try {
    switch (a._[0]) {
      case "ask": ask(a, { q: String(a.q ?? ""), opts: a.opt }); break;
      case "task": noRun(a); ask(a, taskCard(String(a.do ?? ""))); break;
      case "text": {
        noRun(a);
        if (typeof a.default !== "string") throw new Error('text needs --default "what you do if skipped"');
        ask(a, textCard(String(a.q ?? ""), a.default));
        break;
      }
      case "answers": answers(a); break;
      case "done": {
        const id = a._[1], dir = repoDir(a.repo as string | undefined);
        if (!id || typeof a.reason !== "string") throw new Error('usage: done <id> --reason "what you did"');
        bd(dir, "label", "remove", id, "decided");
        bd(dir, "close", id, "--reason", a.reason);
        break;
      }
      default: console.error("usage: decide.ts ask|task|text|answers|done (see header)"); process.exit(2);
    }
  } catch (e) { console.error((e as Error).message); process.exit(1); }
}
