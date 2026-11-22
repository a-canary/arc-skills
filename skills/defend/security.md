# DefendSecurity — security lens added to a gate (opt-in per repo)

Not a new gate.
A lens set the attacker runs **in addition to** the host gate's own lenses (DefendPlan, DefendMerge, DefendDeploy).
Same seam, same tier, same verdict routing as the host gate.

## Opt-in

A repo turns it on with this line in its root `AGENTS.md`:

```
defend-security: on
```

The repo's `AGENTS.md` may narrow scope (e.g. only changes touching auth, verification, voting, or PII).
No line = lens off; the host gate runs unchanged.

## Reviewer

- A freshly spawned agent briefed as an **attacker**, never the author.
- Brief: "You want to break this. Find the cheapest attack on each lens below; price it."
- Normal reviewers clear code that works as designed; the attacker asks whether the design holds against someone hostile.

## Input (pipe all of it)

1. The host gate's artifact: plan, diff, or release.
2. The repo's threat-relevant invariants (e.g. `CHOICES.md` lines on anonymity, one-person-one-vote).
3. Every trust boundary the artifact touches: endpoints, vendors, logs, stores.

## Mandatory lenses

Each lens answered explicitly; "none" is valid, silence is not.

1. **Fake accounts and vote stuffing** — attacker cost per fake at 10, 1k and 100k accounts, and how detectable each scale is.
   Per-user limits reset with a fresh account; only global, per-address or per-instrument limits bind.
2. **Anonymity linkage** — can identity, address, IP or timing be joined to stances?
   Can a vendor's records (mail house, SMS, payment, analytics) be joined to ours by timestamp, district or ID?
3. **PII at rest and in logs** — what PII is stored, where, for how long, and does any reach request logs, error traces or analytics?
4. **AuthN/AuthZ** — who can call this, and does trust rest on a self-declared field (district, role, email, header)?
5. **Abuse and denial of service** — can one actor exhaust a shared cap (rate limit, quota, mail budget) or run up our bill?
6. **Injection and parsing** — untrusted input reaching SQL, shell, HTML, templates, file paths, or a parser.
7. **Secrets and fail-closed** — secrets in code, logs or client bundles; does a missing key or vendor outage fail closed or silently open?

After the lenses, free attack on anything else.

## Output contract

`CLEAR | ATTACKS`, ranked by severity (critical / high / medium / low).
Each attack carries all three:

- **Where** — `file:line` (or plan section for DefendPlan).
- **Attacker cost** — dollars and effort per unit of damage (per fake account, per linked identity, per exhausted cap); mark estimates `(est)`.
- **Fix** — a concrete change that raises cost or closes the hole, not just the finding.

Shape: "critical — `<file>:<line>` binds the code to the self-declared district with no address check; $0.01/fake (est) at any scale; fix: derive district from the mailed-to address server-side and bind the code to it."

## Verdict routing

Merged into the host gate's verdict: any critical or high attack blocks like a host-gate attack.
medium/low: surfaced verbatim, advisory; file a bead; non-blocking.
Surfaced verbatim; override = ledger note row (gate, lens, attack, why).

## Why

On 2026-11-01 a normal reviewer cleared ndivisible PR #383; a red-team pass then found the postcard code bound to a self-declared district with no address check (critical).
The host lenses ask "does it work"; this lens asks "what does it cost to abuse".
