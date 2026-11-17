import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runNeedsCard } from "./decide";

// repos-jedj: a --run card is a permission ask. The Lead grants it (deploy-run --grant) unless the script
// crosses an operator hard line, which deploy-agent/human-only.txt lists. On 11-17 two permission-only
// --run cards ("Run a read-only listing ...?", "Install ... hook?") passed the question-wording lint.
const dir = mkdtempSync(join(tmpdir(), "run-card-"));
const script = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p; };

test("a benign root script does not need a card", () => {
  expect(runNeedsCard("#!/bin/bash\ninstall -m 0755 src /home/aaron/.git-hooks/pre-push\n")).toBe(false);
});

test("a script crossing a hard line still needs a card", () => {
  expect(runNeedsCard("#!/bin/bash\ngit push --force origin main\n")).toBe(true);
  expect(runNeedsCard("#!/bin/bash\ngh repo edit a-canary/x --visibility public\n")).toBe(true);
});

const decide = join(import.meta.dir, "decide.ts");
const ask = (run: string) => spawnSync("bun", [decide, "ask", "--kind", "deploy", "--title", "Install the hook",
  "--q", "Install the hook with a backup?", "--opt", "Run the install | hook live", "--opt", "Not now | stays off",
  "--adds", "whether the hook goes live today", "--context", "The pre-push hook is missing, so pushes go unchecked.",
  "--run", run, "--dry"], { encoding: "utf8" });

test("decide refuses a --run card whose script a Lead can grant, and names the grant path", () => {
  const r = ask(script("benign.sh", "#!/bin/bash\ninstall -m 0755 a b\n"));
  expect(r.status).not.toBe(0);
  expect(r.stderr + r.stdout).toMatch(/deploy-run[^\n]*--grant/);
});

test("decide still accepts a --run card whose script crosses a hard line", () => {
  const r = ask(script("hard.sh", "#!/bin/bash\n# undo: none\ngit push --force origin main\n"));
  expect(r.stderr + r.stdout).not.toMatch(/--grant/);
  // defend 228 R1: a crash or unrelated refusal must not pass as "accepted"
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/^Run: \S+ sha256: [0-9a-f]{64}$/m);
});

// defend 228 R1: the refusal names a script path that exists, not an unpinned queue path
test("the refusal points at a grant command whose --script path exists", () => {
  const r = ask(script("benign2.sh", "#!/bin/bash\n# undo: none\ninstall -m 0755 a b\n"));
  const m = /--script (\S+)/.exec(r.stderr + r.stdout);
  expect(m).not.toBeNull();
  expect(existsSync(m![1])).toBe(true);
});
