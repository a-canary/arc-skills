# Defend-gate benchmark corpus spec

Ground-truth corpus for benchmarking phase-gate reviewers.
A gate reviewer sees ONLY `context` + `artifact` and must return CLEAR or ATTACKS (with findings).
The hidden key (`defects`, `decoys`, `expected_verdict`) scores it.

## File format

One JSON file per case: `corpus/<id>.json`, UTF-8, valid JSON (escape newlines in strings).

```json
{
  "id": "plan-03",
  "gate": "plan | merge | deploy",
  "title": "short human title",
  "context": "2-5 sentences the gate is given: project, mission, what this artifact is, constraints already agreed",
  "artifact": "the full artifact text: a build plan (markdown), a unified diff with PR description, or a deploy/release proposal",
  "expected_verdict": "ATTACKS | CLEAR",
  "defects": [
    {
      "id": "d1",
      "lens": "one of the lens slugs below",
      "severity": "blocker | major",
      "description": "what is wrong and why it must be fixed before crossing the gate (1-3 sentences)",
      "evidence": "exact short quote from the artifact where the defect lives, or 'ABSENT: <what is missing>' for omissions"
    }
  ],
  "decoys": [
    "something that LOOKS risky but is actually handled in the artifact, and where it is handled — a reviewer flagging this is a false positive"
  ]
}
```

## Lens slugs

security, privacy, sovereignty (vendor lock-in, data residency, self-hostability, single-provider dependency), scale, cost, reliability (failure modes, retries, observability, ops), reversibility (rollback, one-way doors, migrations), correctness (logic bugs, edge cases), evidence (load-bearing claims with no evidence, unprototyped assumptions), ui (visual/layout/rendering), ux-value (does it deliver value the user actually wants), ux-efficiency (clicks, latency, friction, flow), accessibility, compliance (legal, licensing, ToS, regulation), maintainability (scope drift, untestable design, duplication), other (real gate-worthy problem that fits no lens — tests free attack).

## Rules

- Every defect MUST be detectable from `context` + `artifact` alone. No hidden facts.
- Defects are realistic and embedded, never signposted. No "TODO: insecure", no comments admitting the bug, no suspicious variable names. A competent senior reviewer should find it; a skim should not.
- Mix subtlety: about a third obvious-on-careful-read, a third subtle, a third requiring cross-referencing two parts of the artifact.
- Every seeded defect is gate-worthy: it alone justifies ATTACKS. `blocker` = catastrophic/irreversible; `major` = must fix but bounded.
- Artifacts are 40-150 lines, realistic and specific (real-looking names, numbers, code). Diverse domains: trading systems, civic/voting app, LLM infra, consumer web app, CLI tool, data pipeline, mobile app, internal tooling, content publishing.
- CLEAR cases must be genuinely shippable, comparable length and polish to defective ones, and contain 1-2 decoys (risky-looking things that are properly handled in the text). Do not seed minor nits you consider gate-worthy in CLEAR cases.
- Defective cases may also contain decoys.
- Do not mention this benchmark, reviewers, or lenses anywhere in `context`/`artifact`.
- Validate every file parses: `bun -e 'for (const f of process.argv.slice(1)) JSON.parse(await Bun.file(f).text())' corpus/<your files>`.
