// deploy-run.ts — Deploy Agent: runs an operator-accepted card's pinned script as root.
//   bun deploy-run.ts <card-id> [--repo R] [--dry] [--as-user]
//   bun deploy-run.ts --grant <lead> --script <path> [--dry] [--as-user]
//   exit = script's code (0 with --dry), 3 = refused (one-line reason)
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDecision, RUN_TITLE, repoDir } from "../human-gate-post-webui/decide";

export const QUEUE = join(homedir(), "vault", "director", "deploy-queue");
const FENCES = join(dirname(import.meta.path), "fences.txt");

export class Refuse extends Error {}
const refuse = (why: string): never => { throw new Refuse(why); };

export type Deps = {
  bd: (dir: string, ...args: string[]) => string;
  readFile: (p: string) => string;
  queueDir: string;
  fencesFile: string;
  exec: (p: { text: string; hex: string; path: string }, asUser: boolean) => number;
  logChange: (line: string) => void;
  humanOnlyFile?: string;
  review?: (text: string) => { clear: boolean; line: string };
};

function realBd(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(["bd", "-C", dir, ...args], { stderr: "pipe" });
  if (r.exitCode !== 0) refuse(`bd ${args[0]}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

// From /etc/passwd, not $HOME (Bun's userInfo().homedir follows $HOME): a caller-set HOME could point the grant path's
// only gate at a stub that prints CLEAR.
const passwdHome = readFileSync("/etc/passwd", "utf8").split("\n").map((l) => l.split(":")).find((f) => f[2] === String(process.getuid?.()))?.[5];
export const DEFEND_ATTACK = join(passwdHome ?? "/nonexistent", ".claude", "skills", "defend", "bin", "defend-attack");
// Allow-list, not the caller's env: defend-attack takes DEFEND_LOCAL_CMD / DEFEND_OPUS_CMD and finds claude via PATH, so any
// inherited variable could swap the reviewer for a stub. claude lives in ~/.local/bin; jq and curl in /usr/bin.
export const REVIEW_ENV = {
  HOME: passwdHome ?? "/nonexistent",
  PATH: `${passwdHome ?? "/nonexistent"}/.local/bin:/usr/local/bin:/usr/bin:/bin`,
  USER: process.env.USER ?? "",
  LANG: "C.UTF-8",
};

export const ROOT_WRAPPER = "/usr/local/sbin/deploy-root";
// Root: the root-owned wrapper (the one command sudoers allows) copies the queue file into a root-only folder,
// re-checks the hash, the undo line and its own root-owned fence list, logs, then runs the copy (repos-vjpl).
// --as-user: no sudo; the hashed bytes run as an argument, never the path (the queue dir is agent-writable), and not
// via stdin (a command that reads stdin would swallow the remaining lines). For scripts whose every step is `sudo -u <you>`.
// ponytail: root cannot check the accept (card data is writable by the agents' user). Upgrade: signed accepts checked in the wrapper.
export const execArgv = (p: { text: string; hex: string; path: string }, asUser: boolean): string[] =>
  asUser ? ["bash", "-c", p.text] : ["sudo", "-n", ROOT_WRAPPER, p.hex, p.path];

export const realDeps = (): Deps => ({
  bd: realBd,
  readFile: (p) => readFileSync(p, "utf8"),
  queueDir: QUEUE,
  fencesFile: FENCES,
  humanOnlyFile: join(dirname(import.meta.path), "human-only.txt"),
  exec: (p, asUser) => Bun.spawnSync(execArgv(p, asUser), { stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exitCode ?? 1,
  logChange: (line) => {
    const wk = Bun.spawnSync(["date", "-u", "+%G-W%V"]).stdout.toString().trim();
    const f = join(homedir(), "vault", "director", "changes", `${wk}.md`);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, line);
  },
  review: (text) => {
    const lines = text.replace(/\n$/, "").split("\n");
    const diff = [`--- /dev/null`, `+++ b/deploy-script.sh`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
    const tmp = join(homedir(), `.deploy-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.diff`);
    writeFileSync(tmp, diff);
    try {
      // ponytail: the reviewer reads text, so obfuscated commands can slip the human-only regexes; it is the backstop, not a proof.
      // ponytail: a same-user process could swap the temp diff mid-review; deploy-root re-hashing the queue file is what pins the bytes run.
      // A hung reviewer is killed and counts as not clear (exitCode null).
      let r;
      try {
        r = Bun.spawnSync([DEFEND_ATTACK, "--diff", tmp], { env: REVIEW_ENV, stdin: "ignore", stderr: "pipe", timeout: 20 * 60_000 });
      } catch (e) {
        return { clear: false, line: `reviewer did not start: ${(e as Error).message}` };
      }
      return reviewVerdict(r.stdout.toString(), r.exitCode);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
  },
});

export function plan(id: string, repo: string | undefined, d: Deps) {
  const dir = repoDir(repo);
  const card = JSON.parse(d.bd(dir, "show", id, "--json") || "null");
  const c = Array.isArray(card) ? card[0] : card;
  if (!c) refuse(`card ${id} not found`);
  if (c.status === "closed") refuse("card is closed");
  const optA = /<option id="A"[^>]*title="([^"]*)"/.exec(c.description ?? "")?.[1];
  // Allow-list, not deny-list: only a card whose option A says "Run ..." means accept-A = run.
  if (!optA || !RUN_TITLE.test(optA)) refuse(`option A must be titled Run ...; here it is ${optA ?? "missing"}`);
  const comments = (c.comments ?? JSON.parse(d.bd(dir, "comments", id, "--json") || "[]")) as { author?: string; text: string }[];
  const decided = comments.filter((x) => parseDecision(x.text)).at(-1);
  if (!decided) refuse("no DECISION comment");
  const last = parseDecision(decided!.text)!;
  if (last.verb !== "accept") refuse(`last decision is ${last.verb}, not accept`);
  // Option A is "run it" on ask cards (the recommendation); B+ are the alternatives.
  if (last.option && last.option !== "A") refuse(`accepted option ${last.option}, not A`);
  // ponytail: the author field is forgeable by any agent; operator chose fences-only trust (repos-vlqa C). Upgrade: webui-signed accepts.
  if (decided!.author !== "operator") refuse(`decision author is ${decided!.author ?? "unknown"}, not operator`);

  // Only the pin decide.ts appends after </decide>, last match: a Run: line in the card text never counts.
  // ponytail: a re-pin via bd update would run under the old accept; re-pins must be new cards (--replaces). Upgrade: sha8 in the accept text.
  const tail = (c.description ?? "").split("</decide>").at(-1) ?? "";
  const m = [...tail.matchAll(/^Run: (\S+) sha256: ([0-9a-f]{64})\s*$/gm)].at(-1);
  if (!(c.description ?? "").includes("</decide>") || !m) return refuse("no 'Run: <path> sha256: <hex>' line after </decide>");
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

// Only the reviewer's last non-empty stdout line counts: an earlier CLEAR (quoted, or prompted by the script) never does.
export function reviewVerdict(stdout: string, exitCode: number | null): { clear: boolean; line: string } {
  const line = stdout.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  return { clear: exitCode === 0 && /^VERDICT: CLEAR by=\S+$/.test(line), line };
}

// One plain token, so it cannot forge lines in the changes log.
// ponytail: any agent can still name any Lead; the log records the claim, not a proof. Upgrade: per-seat signing.
export const LEAD = /^[a-z][a-z0-9-]{1,39}$/;

export function grantRun(lead: string, path: string, d: Deps) {
  if (!LEAD.test(lead)) refuse("--grant must be a seat name like agents-lead");
  const resolved = resolve(path);
  // Plain characters only: the path is written into the changes log, so a newline in a file name could forge lines.
  // ponytail: no realpath, so a symlink in the queue dir passes; deploy-root runs its own copy only if the hash matches.
  if (!/^[\w./-]+$/.test(resolved)) refuse("script path must be letters, digits, . _ - and /");
  if (!resolved.startsWith(resolve(d.queueDir) + "/")) refuse(`script not under ${d.queueDir}`);
  const text = d.readFile(resolved);
  const undo = /^#\s*undo:\s*(\S.*)$/m.exec(text)?.[1];
  if (!undo) refuse("script has no '# undo: <cmd>' line");
  for (const line of d.readFile(d.fencesFile).split("\n").filter((l) => l.trim())) {
    if (new RegExp(line).test(text)) refuse(`fenced: matches /${line}/`);
  }
  if (!d.humanOnlyFile) refuse("grant path requires humanOnlyFile");
  for (const line of d.readFile(d.humanOnlyFile).split("\n").filter((l) => l.trim())) {
    if (new RegExp(line).test(text)) refuse(`human-only: matches /${line}/; this needs an operator card`);
  }
  if (!d.review) refuse("grant path requires review");
  const r = d.review(text);
  if (!r.clear) refuse(`review not clear: ${r.line}`);
  const hex = createHash("sha256").update(text).digest("hex");
  return { path: resolved, undo, hex, text, lead, review: r };
}

export function main(argv: string[], d: Deps, out: (s: string) => void = console.log): number {
  try {
    // Parse flags that take values: --repo, --grant, --script
    const valueIndices = new Set<number>();
    const flags: Record<string, string | undefined> = { "--repo": undefined, "--grant": undefined, "--script": undefined };
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--repo" || argv[i] === "--grant" || argv[i] === "--script") {
        const val = argv[i + 1];
        if (!val || val.startsWith("-")) {
          refuse(`${argv[i]} requires a non-flag value`);
        }
        flags[argv[i]] = val;
        valueIndices.add(i + 1);
        i++;
      }
    }

    // A misspelled --dry must never fall through to a real run.
    const bad = argv.filter((a) => a.startsWith("-") && !["--repo", "--dry", "--as-user", "--grant", "--script"].includes(a));
    if (bad.length) refuse(`unknown flag ${bad[0]}`);

    const hasGrant = flags["--grant"] !== undefined;
    const hasScript = flags["--script"] !== undefined;
    if (hasGrant !== hasScript) refuse("--grant and --script must both be present");
    const positional = argv.some((a, i) => !a.startsWith("-") && !valueIndices.has(i));
    if (hasGrant && (positional || flags["--repo"] !== undefined)) refuse("--grant runs a script, not a card: drop the card id and --repo");

    const dry = argv.includes("--dry");
    const asUser = argv.includes("--as-user");

    if (hasGrant) {
      // Grant path: no card, independent model review of the exact script bytes
      const p = grantRun(flags["--grant"]!, flags["--script"]!, d);
      if (dry) {
        out(`DRY RUN\nscript: ${p.path}\nhash: ${p.hex.slice(0, 12)}\nundo: ${p.undo}\ngrant: ${p.lead}\nreview: ${p.review.line}`);
        return 0;
      }
      d.logChange(`\n## ${new Date().toISOString()}\n- what: running ${p.path} as ${asUser ? process.env.USER ?? "invoking user" : "root"}\n- grant: ${p.lead} (no card; repos-jedj)\n- review: ${p.review.line}\n- hash: ${p.hex.slice(0, 12)}\n- undo: ${p.undo}\n`);
      const code = d.exec({ text: p.text, hex: p.hex, path: p.path }, asUser);
      d.logChange(`- exit: ${code}\n`);
      return code;
    }

    // Card path
    const id = argv.find((a, i) => !a.startsWith("-") && !valueIndices.has(i));
    if (!id) refuse("usage: deploy-run.ts <card-id> [--repo R] [--dry]");
    const p = plan(id, flags["--repo"], d)!;
    if (dry) {
      out(`DRY RUN\nscript: ${p.path}\nhash: ok ${p.hex.slice(0, 12)}\nundo: ${p.undo}\nfence: clear`);
      return 0;
    }
    // Logged before the run, so a run killed partway still leaves its undo in the changes log.
    d.logChange(`\n## ${new Date().toISOString()}\n- what: running ${p.path} as ${asUser ? process.env.USER ?? "invoking user" : "root"}\n- card: ${p.id}\n- undo: ${p.undo}\n`);
    const code = d.exec(p, asUser);
    d.logChange(`- exit: ${code}\n`);
    return code;
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    console.error(`REFUSED: ${e.message}`);
    return 3;
  }
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2), realDeps()));
