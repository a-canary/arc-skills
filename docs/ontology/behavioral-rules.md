---
surveyed_at_sha: 0ee383652a56756f1883ceef75f25985eec30120
scope: [AGENTS.md, skills/install-behavioral-rules/, skills/anti-sycophancy/, skills/craft-defaults/]
status: stable
---

# Behavioral rules (canonical AGENTS.md)

`AGENTS.md` at the repo root is the **canonical source of always-on agent
rules** for the whole estate. It is git-tracked here; every harness config is
a symlink back to it, so there is exactly one editable copy:

| Path | Role |
|---|---|
| `AGENTS.md` (this repo) | canonical, the only real file |
| `/home/aaron/AGENTS.md` | home-level symlink → canonical |
| `/home/aaron/.claude/CLAUDE.md` | claude harness entry → canonical |
| `/home/aaron/.pi/pi.md` | pi harness entry → canonical |

`skills/install-behavioral-rules/` is the idempotent installer that creates
the symlink map (run on machine setup or when a harness config drifts).

## What the rules cover (shape, not full text)

- File boundaries: AGENTS.md = HOW globally; `~/vault/user.md` /
  `~/vault/USER.md` = WHO (private, override); `<repo>/CHOICES.md` = WHAT;
  `<repo>/CONTEXT.md` = vocabulary; `~/vault/ontology/OVERVIEW.md` = meta map.
- Always-on rules: markdown never wordwrapped, prove-before-scaling, no
  re-reading read files, subagent reports untrusted, /counsel over asking,
  commit identity from `~/vault/USER.md`, write-lane restriction (invariant 7).

## Known gap (certified broken, not a claim of health)

pi's **live** config path is `/home/aaron/.pi/agent/AGENTS.md` — a real file
with stale pre-arc role-hierarchy content — while the installer targets
`/home/aaron/.pi/pi.md`. Pi loads both in every session, so every pi session
runs two conflicting rule sets. Ticketed: `fix-pi-agent-agents-md-stale-role-hierar`.
