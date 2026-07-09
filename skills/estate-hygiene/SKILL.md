---
name: estate-hygiene
description: Audit the repo estate — verdict every repo/stamp retain|deprecate|archive|trash, resolve duplicate lineages, prune litter. Run when the estate feels cluttered or after binning new names into missions.json.
---

# estate-hygiene

Drive the repo estate to the M-0012 objective: every name (disk repo, ledger
stamp, litter dir) carries an explicit **retain | deprecate | archive | trash**
verdict; duplicate lineages resolved. Working sheet:
`arc-webui/docs/repo-estate-audit.md`. Registry: `arc-webui/config/missions.json`.

## Definitions

- **duplication** = two places a change must land. Similar names with zero
  overlap are aliases, not duplicates — collapse by noting the alias, never merge.
- **retain** — active or referenced; keep as-is.
- **deprecate** — superseded but still referenced; note successor, stop new work.
- **archive** — dead, history worth keeping. Stamps: verdict-only (history stays
  in ledger, routed by mission binning). Disk: keep dir read-only or push+delete local.
- **trash** — dead, worthless. ALWAYS via retire pattern:
  `mv <dir> ~/trash/$(date +%s)_<name>-$(date +%Y%m%d)/` BEFORE any delete;
  cancel (never delete) related ledger issues. Reversible for 30 days.

## Verdict evidence (cheapest first — collect ALL before judging ANY)

Per disk repo: `git -C <dir> log -1 --format=%cs` (last commit),
`git status --porcelain | wc -l` (dirty), `git log --branches --not --remotes
--oneline | wc -l` (unpushed), remote URL, open-work count in ledger.
Per stamp: ledger `count(*)`, `max(updated_at)`, state mix.
Cross-refs: `grep -rl <name>` across live repos' configs/docs — a name still
referenced cannot be trashed.

## Hard gates

- **Never trash a repo with unpushed commits or a dirty tree** — flag Aaron-gated.
- **Never trash without the ~/trash export** (retire pattern). No exceptions.
- **Merging two live repos** = Aaron-gated verdict (`retain-pending-merge`);
  record, don't execute.
- Ledger rows: cancel, never DELETE.
- Verdicts recorded in the audit sheet FIRST, executed second, sheet PR'd to
  arc-webui (`--base main`) so /m/autonomy's objective gate is auditable.

## Procedure

1. **Sweep facts** — one pass collecting the evidence table above for every
   `unverified` row in the sheet. No judgments during the sweep.
2. **Lineage verdicts** — blanket-judge families (pi-*, hermes-*, scratch) as
   one act each; then singleton stamps.
3. **Disk verdicts** — the real merge/deprecate calls; apply the duplication
   test ("where would a new feature land?").
4. **Execute** — trash verdicts via retire pattern; litter worktree dirs via
   `git worktree remove` (fall back to trash-move if orphaned). Aaron-gated
   verdicts: record + report, don't act.
5. **Update sheet + shapes** — fill verdict/notes columns; add a
   `shape: framework|surface|domain|corpus|experiment|tooling` line to each
   RETAINED repo's CHOICES.md header. PR the sheet.
6. **Report** — baseline→delta: unverified count before/after, dirs moved,
   names archived, Aaron-gated list.

## Repo-shape doctrine (for step 5 and future "new repo?" calls)

New repo ONLY when it needs its own deploy cadence, privacy boundary, or TTL —
otherwise it's a directory in an existing repo. Seams between repos are data
files with documented shape (ledger.db, missions.json, CHOICES fences), never
shared libraries.
