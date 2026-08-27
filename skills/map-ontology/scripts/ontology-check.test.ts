import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { classify, run } from "./ontology-check.ts";

// --- fixture helpers -------------------------------------------------------

function git(cwd: string, ...args: string[]) {
  const q = (a: string) => (/[ \t]/.test(a) ? JSON.stringify(a) : a);
  execSync(`git ${args.map(q).join(" ")}`, { cwd, stdio: "pipe" });
}

/** Fresh tmp git repo with one committed file in scope and one outside. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "onto-check-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export {};\n");
  writeFileSync(join(root, "README.md"), "# r\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return root;
}

function sha(root: string): string {
  return execSync("git rev-parse HEAD", { cwd: root, stdio: "pipe" }).toString().trim();
}

/** Write docs/ontology/OVERVIEW.md with frontmatter + body claims. */
function writeDoc(
  root: string,
  opts: { sha?: string; scope?: string[] | null; body?: string; status?: string } = {},
) {
  const dir = join(root, "docs", "ontology");
  mkdirSync(dir, { recursive: true });
  const fm: string[] = [];
  if (opts.sha !== undefined) fm.push(`surveyed_at_sha: ${opts.sha}`);
  if (opts.scope) fm.push(`scope: [${opts.scope.join(", ")}]`);
  fm.push(`status: ${opts.status ?? "stable"}`);
  const body = opts.body ?? "";
  writeFileSync(join(dir, "OVERVIEW.md"), `---\n${fm.join("\n")}\n---\n\n${body}\n`);
}

const CRON_OK = "0 3 * * * /home/aaron/.config/arc-hygiene/nightly-self-improve.sh\n17 */2 * * * bun refresh.ts\n";
const ALIASES_OK = JSON.stringify({ default_alias: "planning", aliases: { planning: {}, hard: {} } });

// --- table-driven cases ----------------------------------------------------

interface Case {
  name: string;
  setup: (root: string) => void; // mutate repo / write doc after base commit
  opts?: { crontab?: string; aliases?: string };
  fresh: boolean;
  expectStaleDoc?: boolean;
}

const cases: Case[] = [
  {
    name: "clean doc, no claims, empty scoped diff -> fresh",
    setup: (root) => writeDoc(root, { sha: sha(root), scope: ["src/"] }),
    fresh: true,
  },
  {
    name: "broken path claim -> stale",
    setup: (root) =>
      writeDoc(root, { sha: sha(root), scope: ["src/"], body: "Engine at `src/does-not-exist.ts`." }),
    fresh: false,
  },
  {
    name: "existing path claim -> fresh",
    setup: (root) => writeDoc(root, { sha: sha(root), scope: ["src/"], body: "Engine at `src/app.ts`." }),
    fresh: true,
  },
  {
    name: "non-empty scoped diff since stamp -> stale",
    setup: (root) => {
      writeDoc(root, { sha: sha(root), scope: ["src/"] });
      git(root, "add", "-A");
      git(root, "commit", "-qm", "doc");
      writeFileSync(join(root, "src", "app.ts"), "export const x = 1;\n");
      git(root, "add", "-A");
      git(root, "commit", "-qm", "touch scope");
    },
    fresh: false,
  },
  {
    name: "missing scope -> whole-repo diff (fail-closed)",
    setup: (root) => {
      writeDoc(root, { sha: sha(root), scope: null }); // no scope key
      git(root, "add", "-A");
      git(root, "commit", "-qm", "doc");
      writeFileSync(join(root, "README.md"), "# r2\n"); // outside any plausible scope
      git(root, "add", "-A");
      git(root, "commit", "-qm", "touch readme");
    },
    fresh: false,
  },
  {
    name: "self-update of docs/ontology does not stale the doc",
    setup: (root) => {
      writeDoc(root, { sha: sha(root), scope: ["src/"] });
      git(root, "add", "-A");
      git(root, "commit", "-qm", "doc");
      writeDoc(root, { sha: sha(root), scope: ["src/"], body: "edited" });
      git(root, "add", "-A");
      git(root, "commit", "-qm", "edit ontology itself");
    },
    fresh: true,
  },
  {
    name: "cron claim present in crontab -> fresh",
    setup: (root) =>
      writeDoc(root, {
        sha: sha(root),
        scope: ["src/"],
        body: "Nightly runs via `cron: 0 3 * * * nightly-self-improve.sh`.",
      }),
    opts: { crontab: CRON_OK },
    fresh: true,
  },
  {
    name: "cron claim missing from crontab -> stale",
    setup: (root) =>
      writeDoc(root, {
        sha: sha(root),
        scope: ["src/"],
        body: "Nightly runs via `cron: 4 3 * * * nightly-self-improve.sh`.", // wrong schedule
      }),
    opts: { crontab: CRON_OK },
    fresh: false,
  },
  {
    name: "alias claim resolvable -> fresh",
    setup: (root) => writeDoc(root, { sha: sha(root), scope: ["src/"], body: "Routes via `alias: planning`." }),
    opts: { aliases: ALIASES_OK },
    fresh: true,
  },
  {
    name: "alias claim unresolvable -> stale",
    setup: (root) => writeDoc(root, { sha: sha(root), scope: ["src/"], body: "Routes via `alias: ghost`." }),
    opts: { aliases: ALIASES_OK },
    fresh: false,
  },
  {
    name: "unresolvable surveyed_at_sha -> error verdict, fail-closed",
    setup: (root) => writeDoc(root, { sha: "deadbeef", scope: ["src/"] }),
    fresh: false,
  },
];

describe("ontology-check classifier", () => {
  for (const c of cases) {
    test(c.name, () => {
      const root = makeRepo();
      c.setup(root);
      const res = classify(root, {
        crontab: c.opts?.crontab ?? "",
        aliases: c.opts?.aliases ?? "{}",
      });
      expect(res.fresh).toBe(c.fresh);
      expect(res.docs.length).toBe(1);
    });
  }

  test("no ontology dir -> fresh (nothing to check)", () => {
    const root = makeRepo();
    const res = classify(root, { crontab: "", aliases: "{}" });
    expect(res.fresh).toBe(true);
    expect(res.docs.length).toBe(0);
  });

  test("CLI exit codes: 0 fresh / 1 stale", () => {
    const root = makeRepo();
    writeDoc(root, { sha: sha(root), scope: ["src/"] });
    git(root, "add", "-A");
    git(root, "commit", "-qm", "doc");
    expect(run([root], { crontab: "", aliases: "{}" })).toBe(0);

    writeFileSync(join(root, "src", "app.ts"), "export const y = 2;\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "stale it");
    expect(run([root], { crontab: "", aliases: "{}" })).toBe(1);
  });
});
