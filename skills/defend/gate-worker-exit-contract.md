# Gate Worker Exit Code Contract (repos-w0vkf)

A gate worker's exit code must encode the **presence of its artifact**, not just the
process's exit status. A worker that cannot produce its artifact must exit non-zero
and say which artifact was missing.

This is the shared contract for all gate workers, established after two silent-failure
incidents (2026-11-20): a DefendPlan attack that returned no verdict (bg task b0d4414fd)
and a build worker that exited 0 with an empty output file.

## Exit codes

| Exit | Meaning | Example |
|------|---------|---------|
| 0 | Gated: artifact produced successfully | `VERDICT: CLEAR` written |
| 1 | Gated: artifact produced, negative result | `VERDICT: BLOCK` written |
| 2 | Refused before launch (usage error, missing input) | Bad args, no diff to review |
| 3 | Ran, produced nothing that counts | No `VERDICT:` line in output |
| 124 | Timeout | Wall-clock limit exceeded |

Any other non-zero code means a runtime error; the caller must treat it as a failed gate.

## Artifact requirement

Every gate worker must produce a named artifact on success (exit 0 or 1). The artifact
is a specific, parseable output that the caller can verify:

- Reviewers: a line matching `^VERDICT: (CLEAR|ATTACKS|BLOCK)`
- Build workers: a commit on the worktree HEAD (HEAD moved)
- Deploy workers: a deploy receipt

If the artifact is missing, the worker exits 3 (ran, no artifact) or 2 (refused),
never 0.

## Caller responsibility

The caller of a gate worker must verify the artifact, not just the exit code. Exit 0
means the worker claims to have produced the artifact; the caller checks:

1. Exit code is 0 or 1
2. The artifact is present in the output (grep for the verdict line, check HEAD moved, etc.)
3. If the artifact is missing, treat the gate as failed regardless of exit code

This double-check protects against workers that exit 0 erroneously.

## Reference implementation

`skills/defend/bin/defend-ask` implements this contract (repos-18bvp):
- Keeps runner stdout in a temp file
- Greps for the required artifact (`^VERDICT: (CLEAR|ATTACKS)`)
- Returns 3 if the artifact is missing
- Prints the transcript path for the ledger

## Existing workers

- `defend-attack`: exit 0 = CLEAR, exit 1 = BLOCK, exit 2 = usage/Opus failure. Requires VERDICT line. ✓
- `defend-ask`: exit 0 = gated, exit 1 = general error, exit 2 = refused, exit 3 = no artifact. ✓
- `bg_pi_task` (DefendPlan): **does not follow this contract** — exits 0 with empty output on failure. Needs fix in pi-mono.
- `bg_run`: **does not follow this contract** — exits 0 with empty output on failure. Needs fix in pi-mono.

The pi-mono fixes are out of scope for this skill; the caller-side check (verify the artifact)
is the mitigation until those land.
