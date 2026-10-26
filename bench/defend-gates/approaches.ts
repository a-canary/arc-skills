// Gate-running strategies under test. Worker model held constant (W) so structure, not tier, is compared;
// S appears only where escalation to a stronger tier IS the strategy (cascade, single-strong reference).
import { type Usage, callJson, stage, zero } from "./lib";

export const W = "haiku";
export const S = "sonnet";

export type Attack = { lens: string; severity: "blocker" | "major" | "minor"; claim: string; evidence: string };
export type Verdict = { verdict: "CLEAR" | "ATTACKS"; confidence?: number; attacks: Attack[] };
export type Case = { id: string; gate: string; title: string; context: string; artifact: string };
export type Result = Verdict & { usage: Usage };

export const LENSES: Record<string, string> = {
  security: "authn/authz, injection, secrets, trust boundaries, untrusted input reaching writes/exec/external calls",
  privacy: "personal data collection, retention, exposure, linkability, consent",
  sovereignty: "vendor lock-in, single-provider dependency, data residency, self-hostability, exit cost",
  scale: "behaviour at 10-100x load/data, hot paths, unbounded growth, N+1, quotas",
  cost: "money/compute/token spend, budget math, runaway or unbounded spend",
  reliability: "failure modes, retries, timeouts, partial failure, observability, alerting, ops burden",
  reversibility: "rollback path, one-way doors, destructive migrations, irreversible public actions",
  correctness: "logic bugs, edge cases, off-by-one, concurrency, wrong math, spec mismatch",
  evidence: "load-bearing claims with no evidence, unprototyped assumptions, claims contradicted elsewhere in the artifact",
  ui: "visual rendering, layout, broken/misleading display, copy errors",
  "ux-value": "does this deliver value users actually want; solving the wrong problem",
  "ux-efficiency": "friction, extra steps, latency, confusing flows",
  accessibility: "screen readers, contrast, keyboard access, motion, language",
  compliance: "law, regulation, licensing, platform ToS, financial/election rules",
  maintainability: "scope drift, untestable design, duplication, hidden coupling",
};
const slugs = Object.keys(LENSES);
const lensList = (ls = slugs) => ls.map((l) => `- ${l}: ${LENSES[l]}`).join("\n");

const BASE = `You are a Defend gate reviewer. An artifact is about to cross a phase gate (plan→build, PR→merge, or release→production).
Find problems that must be fixed BEFORE it crosses. Ground every attack in the artifact text; never invent facts.
Severity: blocker = catastrophic or irreversible; major = must fix before crossing; minor = non-blocking nit.
A clean artifact must be CLEARed — false blocks waste a whole cycle.`;

const ATTACK_SHAPE = `{"lens":"<slug or other>","severity":"blocker"|"major"|"minor","claim":"<what is wrong, 1-2 sentences>","evidence":"<short quote from artifact, or ABSENT: what is missing>"}`;
const VERDICT_OUT = `Return ONLY JSON, no prose:
{"verdict":"CLEAR"|"ATTACKS","confidence":<0..1>,"attacks":[${ATTACK_SHAPE}, ...]}
verdict is ATTACKS iff at least one attack is blocker or major.`;
const ATTACKS_OUT = `Return ONLY JSON, no prose: {"attacks":[${ATTACK_SHAPE}, ...]} — an empty list is valid and expected when you find nothing.`;

const input = (c: Case) => `GATE: ${c.gate}\nTITLE: ${c.title}\n\nCONTEXT:\n${c.context}\n\nARTIFACT:\n${c.artifact}`;

const RUBRIC = `Mandatory lenses — address every one (silently skipping is not allowed; "nothing" is a valid per-lens result):
${lensList()}
After the lenses, free-attack anything else gate-worthy (lens "other").`;

const norm = (v: Verdict): Verdict => {
  const attacks = Array.isArray(v.attacks) ? v.attacks : [];
  // Verdict follows the contract, not the model's label (some models label CLEAR while listing majors).
  const blocks = attacks.some((a) => a.severity === "blocker" || a.severity === "major");
  return { verdict: blocks ? "ATTACKS" : "CLEAR", confidence: v.confidence, attacks };
};

// Specialist that returns attacks only (used by panels).
const specialist = (u: Usage, c: Case, role: string, model = W) => () =>
  callJson<{ attacks: Attack[] }>(u, model, `${BASE}\n\n${role}\n\n${ATTACKS_OUT}`, input(c));

async function compile(u: Usage, c: Case, reports: unknown, model = W): Promise<Verdict> {
  const [v] = await stage(u, [() => callJson<Verdict>(u, model,
    `${BASE}\n\nYou are the gate compiler. Several reviewers inspected the artifact independently. Merge their reports into one verdict:
deduplicate attacks that describe the same problem; drop attacks not supported by the artifact text or that the artifact already handles;
keep each surviving attack's best wording; re-grade severity honestly.\n\n${VERDICT_OUT}`,
    `${input(c)}\n\nREVIEWER REPORTS:\n${JSON.stringify(reports, null, 1)}`)]);
  return norm(v);
}

type Approach = (c: Case) => Promise<Result>;

async function rubricOnce(u: Usage, c: Case, model = W): Promise<Verdict> {
  const [v] = await stage(u, [() => callJson<Verdict>(u, model, `${BASE}\n\n${RUBRIC}\n\n${VERDICT_OUT}`, input(c))]);
  return norm(v);
}

const STOP_ORDER = ["security", "privacy", "correctness", "reversibility", "compliance", "reliability", "evidence", "cost",
  "scale", "sovereignty", "ux-value", "ux-efficiency", "accessibility", "ui", "maintainability"];

const CLUSTERS: Record<string, string[]> = {
  trust: ["security", "privacy", "sovereignty", "compliance"],
  ops: ["scale", "cost", "reliability", "reversibility"],
  user: ["ui", "ux-value", "ux-efficiency", "accessibility"],
  engineering: ["correctness", "evidence", "maintainability"],
};

const COUNSEL_AXES: Record<string, string> = {
  advocate: "Steelman — argue FOR the artifact. Which apparent risks are actually handled? Push back on weak attacks.",
  critic: "Argue AGAINST — flaws, failure modes, hidden costs, weak assumptions a hostile reviewer would find.",
  pragmatist: "Implementation reality now — cost, time, complexity, dependencies, day-to-day operation.",
  historian: "Past precedent — what usually goes wrong with artifacts like this; known failure patterns.",
  futurist: "Long-term — second-order effects, scaling, lock-in, what this commits us to in 6-24 months.",
};

export const APPROACHES: Record<string, { desc: string; fn: Approach }> = {
  "rubric-single": {
    desc: "1 worker agent walks the full 15-lens rubric + free attack, emits verdict",
    fn: async (c) => { const u = zero(); return { ...(await rubricOnce(u, c)), usage: u }; },
  },
  "rubric-stop-early": {
    desc: "1 worker agent walks a priority-ordered rubric and halts at the first gate-worthy finding",
    fn: async (c) => {
      const u = zero();
      const [v] = await stage(u, [() => callJson<Verdict>(u, W,
        `${BASE}\n\nWalk these lenses IN ORDER:\n${lensList(STOP_ORDER)}\nthen free attack (lens "other").
STOP at the FIRST blocker or major finding and output immediately with that single attack. If you finish every lens with nothing gate-worthy, output CLEAR.\n\n${VERDICT_OUT}`,
        input(c))]);
      return { ...norm(v), usage: u };
    },
  },
  "self-consistency-3": {
    desc: "3 independent rubric-single runs; majority verdict; union of attacks from blocking runs",
    fn: async (c) => {
      const u = zero();
      const runs = (await stage(u, [0, 1, 2].map(() => () =>
        callJson<Verdict>(u, W, `${BASE}\n\n${RUBRIC}\n\n${VERDICT_OUT}`, input(c))))).map(norm);
      const blocking = runs.filter((r) => r.verdict === "ATTACKS");
      const verdict = blocking.length >= 2 ? "ATTACKS" : "CLEAR";
      return { verdict, attacks: verdict === "ATTACKS" ? blocking.flatMap((r) => r.attacks) : [], usage: u };
    },
  },
  "clustered-panel": {
    desc: "4 cluster agents (trust/ops/user/engineering, 3-4 lenses each + free attack) → compiler",
    fn: async (c) => {
      const u = zero();
      const reports = await stage(u, Object.entries(CLUSTERS).map(([name, ls]) => specialist(u, c,
        `You are the ${name} reviewer. Cover ONLY these lenses (others are covered by colleagues):\n${lensList(ls)}\nThen free-attack anything gate-worthy nobody else would catch (lens "other").`)));
      return { ...(await compile(u, c, Object.fromEntries(Object.keys(CLUSTERS).map((k, i) => [k, reports[i]])))), usage: u };
    },
  },
  "elephant-gold": {
    desc: "15 single-lens specialists + 1 free-attack generalist in parallel → compiler",
    fn: async (c) => {
      const u = zero();
      const roles = [...slugs.map((l) => [l, `You are the ${l} specialist. Review ONLY through this lens: ${LENSES[l]}. Other specialists cover every other concern — stay in your lane.`]),
        ["free", `You are the free-attack generalist. Specialists already cover: ${slugs.join(", ")}. Find gate-worthy problems that fall between or outside those lenses (lens "other").`]];
      const reports = await stage(u, roles.map(([, r]) => specialist(u, c, r)));
      return { ...(await compile(u, c, Object.fromEntries(roles.map(([k], i) => [k, reports[i]])))), usage: u };
    },
  },
  "triage-routed": {
    desc: "1 triage agent picks ≤4 relevant lenses → those specialists + free attack → compiler",
    fn: async (c) => {
      const u = zero();
      const [t] = await stage(u, [() => callJson<{ lenses: string[] }>(u, W,
        `You route a gate review. Pick the at most 4 lenses where this artifact most plausibly hides a gate-worthy problem.\n${lensList()}\nReturn ONLY JSON: {"lenses":["slug",...]}`, input(c))]);
      const picked = (t.lenses ?? []).filter((l) => l in LENSES).slice(0, 4);
      const roles = [...picked.map((l) => [l, `You are the ${l} specialist. Review ONLY through this lens: ${LENSES[l]}.`]),
        ["free", `You are the free-attack generalist. Colleagues cover: ${picked.join(", ")}. Find any other gate-worthy problem.`]];
      const reports = await stage(u, roles.map(([, r]) => specialist(u, c, r)));
      return { ...(await compile(u, c, Object.fromEntries(roles.map(([k], i) => [k, reports[i]])))), usage: u };
    },
  },
  "cascade": {
    desc: "worker rubric screen; confident CLEAR exits, otherwise strong-tier verifier re-reviews and confirms/drops/adds",
    fn: async (c) => {
      const u = zero();
      const first = await rubricOnce(u, c);
      if (first.verdict === "CLEAR" && (first.confidence ?? 0) >= 0.8) return { ...first, usage: u };
      const [v] = await stage(u, [() => callJson<Verdict>(u, S,
        `${BASE}\n\n${RUBRIC}\n\nA first-pass reviewer produced the report below. Verify each attack against the artifact (drop unsupported ones), then run the rubric yourself and add anything it missed.\n\n${VERDICT_OUT}`,
        `${input(c)}\n\nFIRST-PASS REPORT:\n${JSON.stringify(first, null, 1)}`)]);
      return { ...norm(v), usage: u };
    },
  },
  "counsel-5x2": {
    desc: "incumbent /counsel: 5 axes (advocate/critic/pragmatist/historian/futurist) × 2 rounds → synthesis",
    fn: async (c) => {
      const u = zero();
      const OUT = `Return ONLY JSON: {"position":"<3-5 sentences>","attacks":[${ATTACK_SHAPE}, ...]}`;
      const axes = Object.entries(COUNSEL_AXES);
      const sys = (name: string, desc: string) => `${BASE}\n\nYou are the ${name} on a 5-expert counsel panel. Your axis: ${desc}\n${RUBRIC}`;
      const r1 = await stage(u, axes.map(([n, d]) => () => callJson(u, W, `${sys(n, d)}\n\nROUND 1: opening argument.\n${OUT}`, input(c))));
      const panel = Object.fromEntries(axes.map(([n], i) => [n, r1[i]]));
      const r2 = await stage(u, axes.map(([n, d]) => () => callJson(u, W,
        `${sys(n, d)}\n\nROUND 2: rebut the weakest argument from another expert, update your position, give your refined attack list.\n${OUT}`,
        `${input(c)}\n\nROUND 1 PANEL:\n${JSON.stringify(panel, null, 1)}`)));
      return { ...(await compile(u, c, Object.fromEntries(axes.map(([n], i) => [n, r2[i]])))), usage: u };
    },
  },
  "single-strong": {
    desc: "reference: 1 strong-tier (sonnet) agent, full rubric",
    fn: async (c) => { const u = zero(); return { ...(await rubricOnce(u, c, S)), usage: u }; },
  },
};
