---
name: token-waste
description: Audit the day's sessions for token waste (context loaded but unused or loaded badly) and make one surgical system change to stop the worst recurring pattern. Companion to /dream — /dream fixes agent effectiveness, this fixes context-window economy. Use when the user wants to find token waste, audit context usage, identify confusing/obvious/repeated instructions, or tally what was loaded but not used.
allowed-tools: Read, Write, Glob, Task, Bash
---

# Token-Waste

Mine today's Claude sessions for **token waste**: context that was loaded but didn't
earn its place. Where `/dream` asks "did the agent act effectively?", this asks "did
the agent pay for tokens it didn't need?"

Two phases, mirroring `/dream`:

- **Phase 1 — Analyze** (cheap, high-volume): a deterministic Python detector sizes
  every tool result and shortlists waste; a haiku `waste-analyst` confirms and scores.
  Output: `/tmp/session-waste-examples-<YYYYMMDD>.json`.
- **Phase 2 — Adapt** (one capable model, one edit): the opus `waste-adapter` reads
  that tally, picks the single highest-impact recurring pattern, and makes **exactly
  one** surgical change to an agent / skill / tool / rule so it stops recurring. One
  improvement per day — attributable and reversible.

Phase 1 flags, per session, in three families.

*How* result context was loaded:
- **full_file_read** — read a whole large file when Grep + a targeted read would do
- **reread** — read a file already in context (same file path)
- **no_grep_first** — large Read with no Grep of that path beforehand
- **bash_dump** — large Bash stdout dumped to context instead of piped to a file
- **unreferenced** — a large tool result whose content never reappeared afterward

*What* was loaded — content quality on ANY large result (doc, Read, Bash, agent reply):
- **repeated** — content that substantially duplicates an earlier large result by
  *content overlap*, any tool/path (the same doc fetched twice, a re-dumped output)
- **obvious** / **confusing** — the detector shortlists large results as
  `low_value_content` with a bounded excerpt; the analyst classifies each as
  **obvious** (filler / low-information at that size), **confusing** (contradictory
  or ambiguous), or drops it as load-bearing

*Instruction context* — the directive text the harness *re-injects* every turn (skill
bodies, the skill catalog, memory/CLAUDE.md, system-reminders), which never flows
through tool results and is usually the heaviest, most repetitive context in a
session — a 1k-token skill body re-injected 180× is ~180k tokens:
- **repeated_instruction** — the same instruction block re-injected N+ times;
  deterministic, charges the aggregate cost of every copy past the first
- **obvious_instruction** / **confusing_instruction** — the detector shortlists a
  large instruction block as `instruction_review` with a bounded excerpt; the analyst
  classifies the directive *text itself* as **obvious_instruction** (extreme-obvious
  filler the model already acts on), **confusing_instruction** (contradictory or
  ambiguous), or drops it as load-bearing

A cheap deterministic Python pass (`lib/detect_waste.py`) does the sizing and pattern
matching; a haiku `waste-analyst` agent only scores the shortlist and prescribes the
cheaper alternative. The LLM never reads the raw transcript — for the content-quality
patterns (`obvious`/`confusing`) the detector hands it a bounded head+tail **excerpt**
of each shortlisted result, capped at the largest few per session — so the tool that
hunts token waste doesn't waste tokens itself.

## Phase 1 output

A single per-day JSON file:

```
/tmp/session-waste-examples-<YYYYMMDD>.json
```

Shape:
```json
{
  "date": "20260528",
  "sessions_analyzed": 7,
  "total_candidate_wasted_tokens": 41000,
  "by_pattern": { "full_file_read": 12, "reread": 5, "bash_dump": 3, "repeated_instruction": 8, ... },
  "examples": [ { ...one confirmed waste example per entry... } ]
}
```

## Phase 1 — Analyze

### Step 1 — Resolve the target day + the detector path

`WASTE_DAY` (YYYYMMDD) overrides which day to analyze; unset means today. A
nightly cron firing after midnight must set it to the day that just ended
(`WASTE_DAY=$(date -d yesterday +%Y%m%d)`) — otherwise the scan only sees the few
hours since midnight and misses the whole prior day.

```bash
DAY="${WASTE_DAY:-$(date +%Y%m%d)}"
DAYDASH=$(date -d "$DAY" +%Y-%m-%d)       # same day, dash form, for -newermt
NEXT=$(date -d "$DAY + 1 day" +%Y-%m-%d)  # upper bound so we get only that day
OUT="/tmp/session-waste-examples-${DAY}.json"
DETECT="$HOME/.claude/skills/token-waste/lib/detect_waste.py"
WORK="$HOME/.claude/waste/$DAY"           # scratch for per-session candidate JSON
mkdir -p "$WORK"
echo "day=$DAY out=$OUT"
```

### Step 2 — Find that day's sessions

Sessions touched on the target day across every project dir (bounded both ends so
a back-dated run doesn't sweep in everything since). **Write the list to a file and
report only the count** — never print the path list to context (that is the day's own
`bash_dump` waste pattern; Step 3 iterates the file, not stdout):

```bash
find ~/.claude/projects -name '*.jsonl' \
  -newermt "$DAYDASH 00:00:00" ! -newermt "$NEXT 00:00:00" -print > "$WORK/sessions.txt"
wc -l < "$WORK/sessions.txt"   # count only; the path list lives in $WORK/sessions.txt
```

If the count is 0, write an empty result and stop:
```json
{"date":"<DAY>","sessions_analyzed":0,"total_candidate_wasted_tokens":0,"by_pattern":{},"examples":[]}
```

### Step 3 — Detect candidates (deterministic, parallel)

For EACH session file listed in `$WORK/sessions.txt`, run the detector to its scratch
JSON — loop over the file; do not re-list the paths to context. Run up to 5 in parallel:

```bash
python "$DETECT" "<session.jsonl>" --project "<project>" \
  -o "$WORK/<session>.json"
```

Skip any session whose candidate JSON has `"candidate_count": 0` — no point spending
an analyst on a clean session.

### Step 4 — Score candidates (waste-analyst agent, parallel)

For EACH candidate JSON with candidates, spawn the analyst. Run up to 3 in parallel
(haiku is cheap; cap concurrency to keep output orderly):

```
Task: Score waste in <session>
Agent: waste-analyst    # unnamespaced -- the Task `subagent_type` is the bare agent name, NOT `token-waste:waste-analyst`
Prompt: Read $WORK/<session>.json. Confirm real token waste, score severity, and
        prescribe the cheaper tool call per the agent spec. Return the JSON array only.
```

Collect each agent's returned JSON array.

### Step 5 — Merge into the day's tally

Combine all confirmed examples into the single output file. Compute:
- `sessions_analyzed` = count of sessions that had ≥1 candidate
- `total_candidate_wasted_tokens` = sum of `tokens_wasted` across confirmed examples
- `by_pattern` = count of confirmed examples per pattern
- `examples` = the merged array, sorted by `tokens_wasted` descending

Write it to `$OUT` with the Write tool.

### Step 6 — Present

Report to the user:
1. Sessions analyzed and total tokens flagged as wasted
2. `by_pattern` breakdown (which waste shape dominates)
3. Top 5–10 examples (target, pattern, tokens wasted, the cheaper alternative)

Then proceed to Phase 2 — the analysis is the input the adapter acts on.

## Phase 2 — Adapt

Make **exactly one** system change today to stop the worst recurring waste pattern.
One change per run — attributable and reversible, exactly like `/dream`'s adapter.

### Step 7 — Spawn the adapter (one agent, opus)

Only if `$OUT` has ≥1 example. Spawn a single adapter:

```
Task: Adapt away the top token-waste pattern for <DAY>
Agent: waste-adapter    # unnamespaced -- the Task `subagent_type` is the bare agent name, NOT `token-waste:waste-adapter`
Prompt: Read /tmp/session-waste-examples-<DAY>.json. Group examples by root cause,
        pick the single highest-impact group, and make ONE surgical change to an
        agent / skill / tool / ~/AGENTS.md rule so that pattern stops recurring.
        Then append a `## adaptation` block (tagged `source: token-waste`) to today's
        dream journal. One change only.
```

The adapter shares dream's journal (`~/.claude/dream/journal/YYYY-MM-DD.md`) so both
adapters' edits land in one daily audit trail.

### Step 8 — Report the adaptation

Tell the user the one change made: the waste group it targets, the surface touched
(file path), tokens that pattern cost today, and the runners-up the adapter deferred.
If the day was clean (no examples), report that and note no edit was made.

## Tuning

`detect_waste.py` flags:
- Reads ≥ 2000 est. tokens as full-file candidates
- Any tool result ≥ 1500 est. tokens as large (bash_dump / unreferenced / repeated /
  low_value_content)
- `repeated`: two large results with ≥ 0.6 Jaccard overlap on 5-word shingles
- `low_value_content`: the largest ≤ 12 results per session, each with a head+tail
  excerpt (700 + 400 chars) for the analyst; capped so the review itself stays cheap
- `--chars-per-token` defaults to 4; lower it for code-heavy sessions

Instruction context (re-injected directive text, grouped by content fingerprint):
- `repeated_instruction`: a block re-injected ≥ 3 times whose aggregate avoidable
  (post-first) cost is ≥ 2000 est. tokens
- `instruction_review`: instruction blocks ≥ 800 est. tokens/copy, largest ≤ 8 per
  session, each with the same bounded excerpt for the analyst to judge

Adjust the thresholds in the script (`REPEAT_OVERLAP`, `MAX_QUALITY_REVIEW`,
`EXCERPT_HEAD`/`EXCERPT_TAIL`, the result-side `*_TOKENS` cutoffs, and the
instruction-side `REPEAT_INSTRUCTION_MIN` / `REPEAT_INSTRUCTION_MIN_WASTED` /
`INSTRUCTION_REVIEW_TOKENS` / `MAX_INSTRUCTION_REVIEW`) if a project's signal is too
noisy or too sparse.

## Relationship to /dream

Twins, both two-phase (analyze → adapt one change/day):

- `/dream` → **effectiveness**: corrections, wrong tools, repeated attempts.
  Phase 1 writes `~/.claude/dream/journal/`; Phase 2 adapter makes one fix.
- `/token-waste` → **economy**: context loaded but unused. Phase 1 writes a day
  file to `/tmp`; Phase 2 `waste-adapter` makes one fix.

Run them independently. They share the JSONL source, the deterministic-extraction-
first philosophy (LLM only on the shortlist), and the **same daily journal** for
adaptations — the waste-adapter tags its `## adaptation` block `source: token-waste`
so the two adapters' edits stay distinguishable in one audit trail. Phase-1 outputs
never collide.

See [SETUP.md](SETUP.md) for the one-time agent install and model config.

## Error handling

- Empty/corrupt session JSONL → detector skips silently; continue.
- Detector error on one session → log, continue with the rest.
- Analyst returns non-JSON → retry once, then drop that session's examples.
- No sessions today → write the empty-result file (Step 2) and report "clean day".
