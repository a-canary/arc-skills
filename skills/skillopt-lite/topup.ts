// Synthetic top-up for skillopt-lite eval sets (bead arc-3or, option C).
// Real uses always come first; synthetic cases only fill up to `target`.
// Synthetic cases are cached per skill, keyed by SKILL.md content hash, so the model runs once per spec version.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type Row = { id: string; prompt: string; synthetic?: boolean; [k: string]: unknown };
export type Gen = (spec: string, seeds: Row[], need: number) => Promise<string[]>;

export const specHash = (spec: string) => createHash("sha256").update(spec).digest("hex").slice(0, 16);

export async function topUp(
  real: Row[], spec: string, opts: { target: number; cacheDir: string; gen: Gen },
): Promise<{ rows: Row[]; real: number; synthetic: number; cached: boolean }> {
  const need = opts.target - real.length;
  if (need <= 0) return { rows: real, real: real.length, synthetic: 0, cached: false };
  const file = join(opts.cacheDir, `${specHash(spec)}.json`);
  let prompts: string[] = [];
  let cached = false;
  if (existsSync(file)) {
    try { prompts = JSON.parse(readFileSync(file, "utf8")); } catch { prompts = []; }
    cached = prompts.length >= need;
  }
  if (!cached) {
    prompts = (await opts.gen(spec, real, need)).filter((p) => typeof p === "string" && p.trim()).slice(0, need);
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(prompts));
  }
  const synth = prompts.slice(0, need).map((prompt, i) => ({ id: `synth-${specHash(spec)}-${i}`, prompt, output: null, synthetic: true }));
  return { rows: [...real, ...synth], real: real.length, synthetic: synth.length, cached };
}

export const genPrompt = (spec: string, seeds: Row[], need: number) =>
  `You write realistic test inputs for an AI agent skill.\n\nSKILL SPEC:\n${spec.slice(0, 12000)}\n\n` +
  (seeds.length ? `REAL EXAMPLE TASKS (match their style and variety, do not copy):\n${seeds.slice(0, 5).map((s) => `- ${s.prompt.slice(0, 600)}`).join("\n")}\n\n` : "") +
  `Write exactly ${need} distinct, self-contained task prompts that a dispatching agent might send to this skill. ` +
  `Reply with a STRICT JSON array of ${need} strings, nothing else.`;

export const parsePrompts = (raw: string): string[] => {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array in model reply");
  const a = JSON.parse(m[0]);
  if (!Array.isArray(a)) throw new Error("reply not an array");
  return a.map(String);
};

// Gate rule (arc-3or): any REAL-case loss rejects outright; only with zero real losses does the pooled Wilson decide.
export const wilsonLower = (w: number, n: number) => {
  if (n === 0) return 0;
  const z = 1.96, p = w / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
};

export function decide(vs: { winner: string; synthetic?: boolean }[]) {
  const c = (syn: boolean, win: string) => vs.filter((v) => !!v.synthetic === syn && v.winner === win).length;
  const rw = c(false, "challenger"), rl = c(false, "champion"), sw = c(true, "challenger"), sl = c(true, "champion");
  const lb = wilsonLower(rw + sw, rw + sw + rl + sl);
  const verdict = rl > 0 ? "HOLD" : lb > 0.5 ? "PROMOTE" : "HOLD";
  return { verdict, rw, rl, sw, sl, lb, dropped: vs.length - rw - rl - sw - sl };
}
