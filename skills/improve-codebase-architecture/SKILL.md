---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary." Terms: **Module, Interface** (everything a caller must know, not just the signature), **Implementation, Depth** (Deep = high leverage; Shallow = interface ≈ implementation), **Seam** (where an interface lives; use this not "boundary"), **Adapter, Leverage, Locality**. Full definitions + the rest of the principles in [LANGUAGE.md](LANGUAGE.md) — read it before your first suggestion.

Load-bearing principles to apply every time:

- **Deletion test**: imagine deleting the module. Complexity vanishes → pass-through. Complexity reappears across N callers → it earns its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

## Process

Three phases. **Full step-by-step in [PROCESS.md](PROCESS.md) — read it once when you start a run, then work from it.**

1. **Explore** — read the domain glossary + relevant ADRs first; then `subagent_type=Explore` to walk the code, noting friction (shallow modules, leaky seams, untested-through-interface code). Apply the **deletion test** to anything suspected shallow.
2. **Present candidates** — numbered list; per candidate give Files / Problem / Solution / Benefits (in locality + leverage + test terms). Use CONTEXT.md vocab for the domain, [LANGUAGE.md](LANGUAGE.md) vocab for architecture. Flag ADR conflicts only when friction warrants reopening. Don't propose interfaces yet — ask which to explore.
3. **Grilling loop** — once a candidate is picked, walk the design tree (constraints, deps, seam shape, surviving tests). Side effects land inline: update `CONTEXT.md` for new/sharpened terms, offer an ADR on load-bearing rejections, see [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) for alternative interfaces. Exact wording + grill-with-docs format pointers live in [PROCESS.md](PROCESS.md).
