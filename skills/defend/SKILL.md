---
name: defend
description: The Defend* gate family — named critical junctions where an independent model attacks the artifact before it crosses the seam. DefendPlan (opus, wayfinder→build), DefendMerge (workhorse, worker→git merge = /hard-merge), DefendRelease (opus, qa-passed→public deploy). Use when a plan is about to be dispatched to build, a diff is about to merge, or anything is about to go public.
---

# defend — critical-junction gate family

One seam concept, three named gates. At each gate an **independent** model
attacks the artifact before it crosses into the next phase. The name marks the
junction; the tier marks the cost.

## The pipeline

```
PLAN     User ⇄ Director.qwen ⇄ DefendPlan.OPUS ────────────► Driver
BUILD    Driver.qwen(delegates) ► Worker.qwen|bonsai ⇄ DefendMerge.QWEN ► git merge ► Driver
RELEASE  Driver(prototype) ⇄ QA.qwen ► User(webui review)
         Driver(plan) ⇄ QA.qwen ⇄ DefendRelease.OPUS ► Driver(public deploy).qwen ► User(notify)
```

| Gate | Seam | Tier | File |
| --- | --- | --- | --- |
| **DefendPlan** | wayfinder result → build dispatch | Opus (ask-claude) | [plan.md](plan.md) |
| **DefendMerge** | worker diff → git merge | workhorse, fresh context (= /hard-merge) | [merge.md](merge.md) |
| **DefendRelease** | qa-passed artifact → public deploy | Opus (ask-claude) | [release.md](release.md) |

## Why this tiering

Opus only where the outcome is expensive AND hard to reverse: a bad plan burns
a whole sprint; a bad release is public. Merges are frequent and git-reversible,
so fresh-context workhorse independence is proportionate there. Opus budget =
junction count, bounded by construction.

## Rubric rule — floor, not fence

Each gate has **mandatory lenses** (the rubric). The attacker must address
every lens explicitly; "no findings" is a valid answer per lens, silence is
not. After the lenses, the attacker runs **free attack** on anything else it
sees — the rubric is a minimum attack surface, Opus adapts to conditions.

## Verdict + override

All gates use the ask-claude verdict contract: `CLEAR | ATTACKS`, ranked,
each attack satisfiable. ATTACKS are surfaced **verbatim** to the caller —
never summarized away. An override (ship anyway) is a ledger event: gate,
attacks overridden, why. Opus/CLEAR is still an untrusted report — verify
checkable claims against source.

## Wiring points

- DefendPlan: director/wayfinder flow, before build dispatch (see plan.md).
- DefendMerge: /hard-merge IS this gate — same procedure, named here.
- DefendRelease: after QA pass + human webui review, before public deploy
  (app version, YT video, X post, website content) — see release.md.
