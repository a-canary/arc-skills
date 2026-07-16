---
name: counsel
description: "Run an adversarial counsel session with 5 domain experts. Each expert takes turns running queries (read files, ke-recall) and presenting arguments across 2 rounds, then synthesize into a concise report or course of action. Use when user says 'counsel', 'get expert advice', 'adversarial review', or wants multiple perspectives on a decision."
---

# Counsel — Adversarial Expert Panel

Simulates an adversarial conversation between 5 domain experts to stress-test a decision, plan, or technical approach.

## Workflow

### Round 1: Independent Investigation + Opening Arguments

1. **Spawn 5 expert sub-sessions** in parallel:
   - `skeptic` — Challenges assumptions, finds weaknesses
   - `pragmatist` — Focuses on implementation reality
   - `strategist` — Evaluates long-term implications
   - `historian` — Draws parallels to past decisions (via ke:recall)
   - `devil-advocate` — Takes the opposing position

2. **Each expert runs their own research:**
   ```
   ke:recall <topic>
   read relevant files
   run queries as needed
   ```

3. **Each expert presents opening argument** (3-5 sentences):
   - Their domain's perspective
   - Key concerns or opportunities
   - Preliminary verdict

### Round 2: Rebuttal + Refinement

4. **Cross-examination round** — each expert:
   - Responds to the weakest argument from another expert
   - Updates their position based on new information
   - Presents refined stance

5. **Final arguments** (2-3 sentences each)

### Synthesis

6. **Generate report:**
   ```markdown
   ## Counsel Report: [Topic]

   ### Consensus Points (N/5 agree)
   - ...

   ### Key Disagreements
   - ...

   ### Strongest Arguments
   - ...

   ### Recommended Course of Action
   1. ...
   2. ...
   3. ...

   ### Dissenting Views
   - ...
   ```

## Implementation Notes

- Use `claude-afk` or ledger child tasks for each expert sub-session
- Experts can read files and run ke:recall within their session
- Round 2 prompt includes all Round 1 arguments for cross-examination
- Final synthesis prioritizes actionable recommendations over academic debate

## Constraints

- 2 rounds maximum (avoids analysis paralysis)
- Each argument limited to 5 sentences max (forces clarity)
- Report must include concrete next steps
