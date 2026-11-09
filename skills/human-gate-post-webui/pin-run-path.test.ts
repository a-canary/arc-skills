import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pinRun } from "./decide";

// `sudo -u <user>` resets PATH to secure_path, dropping ~/.local/bin and ~/.bun/bin (age, bun): a pinned
// script that relies on them fails mid-run after the operator already accepted it. Refuse at post time.
const dir = mkdtempSync(join(tmpdir(), "pin-path-"));
const script = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p; };

test("pinRun refuses a sudo -u script that never sets PATH", () => {
  const p = script("bad.sh", "#!/usr/bin/env bash\nsudo -u aaron -H bash -c 'age -d x.age > /dev/null'\n");
  expect(() => pinRun(p, dir, false)).toThrow(/PATH/);
});

test("pinRun accepts a sudo -u script that sets PATH", () => {
  const p = script("good.sh", "#!/usr/bin/env bash\nsudo -u aaron -H bash -c 'PATH=/home/aaron/.local/bin:/usr/bin:/bin age -d x.age'\n");
  expect(pinRun(p, dir, false)).toMatch(/^Run: .*good\.sh sha256: [0-9a-f]{64}$/);
});

test("pinRun leaves scripts without sudo -u alone", () => {
  const p = script("root.sh", "#!/usr/bin/env bash\nufw status\n");
  expect(pinRun(p, dir, false)).toMatch(/^Run: /);
});

test("re-pinning an already-queued script does not double its hash prefix", () => {
  const p = script("deadbeef-thing.sh", "#!/usr/bin/env bash\nufw status\n");
  const out = pinRun(p, dir, false);
  const hex = out.split("sha256: ")[1]!;
  expect(out).toContain(`/${hex.slice(0, 8)}-thing.sh `);
});
