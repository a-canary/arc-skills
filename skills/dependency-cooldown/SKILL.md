---
name: dependency-cooldown
description: Only adopt open-source or third-party tools/releases that are at least 4 weeks old. Fresh releases may carry undiscovered vulnerabilities. Use when adding, upgrading, or pinning a dependency, package, action, image, or model.
---

# dependency-cooldown

Any open-source or third-party artifact you pull in — npm/pip/cargo package, GitHub Action, container image, model weights, CLI binary, browser extension — must be **at least 4 weeks old** at the version you adopt.

A brand-new release has had the least time for the community to discover supply-chain compromise, malicious maintainer takeover, or accidental RCE-grade bugs. Most such incidents surface within days to a few weeks of publish. Waiting out a 4-week cooldown is the cheapest defense that needs no extra tooling.

## The rule

```
adopted_version.publish_date  <=  today - 28 days
```

- Applies to the **specific version** you pin, not the package's age. A 10-year-old package's release from yesterday is still too fresh.
- Applies to upgrades too: don't bump to a version younger than 28 days.
- Pin exact versions (`==`, `1.2.3`, a digest), never floating ranges (`^`, `latest`, `*`) that could silently pull a same-day release.

## How to apply

When about to add or upgrade a dependency:

1. Look up the publish date of the version you want.
   - npm: `npm view <pkg> time --json` → find the version's timestamp
   - pip: `pip index versions <pkg>` / check the PyPI release history
   - cargo: the crates.io version page
   - GitHub release / Action: the release or tag date
   - container image: the registry push date for that tag/digest
2. If it is **< 28 days old**, step back to the newest version that is **≥ 28 days old** and pin that.
3. If no version meets the bar (brand-new package with no aged release), do not adopt it yet — flag to the user and propose waiting or an established alternative.

## Exceptions (require explicit user approval)

- A **security patch** that fixes an actively-exploited CVE in a version you already run. Here freshness is the point — apply it. Note the CVE.
- A tool that **only exists** as a recent release and is genuinely required now. Surface the risk and let the user decide.

Never silently override the cooldown. State the version, its age, and why an exception applies.

## When NOT to use this skill

- Pulling first-party / internal code (own repos, own packages).
- Reading or referencing a tool's docs without installing it.
- Pinning to a version that already satisfies the bar — no action needed.

## Anti-pattern

Reaching for `latest` or the top of the release list "to stay current." Current is exactly the risk. Default to the newest *aged-out* version.
