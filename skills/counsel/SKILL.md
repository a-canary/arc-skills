---
name: counsel
description: "Run an adversarial counsel session with 5 experts along 5 unique axes (advocate | critic | pragmatist | historian | futurist). Each expert runs queries (read files, ke-recall) and presents arguments across 2 rounds, then synthesize into a concise report or course of action. Use when user says 'counsel', 'get expert advice', 'adversarial review', or wants multiple perspectives on a decision."
---

# Counsel — Adversarial Expert Panel

Simulates an adversarial conversation between 5 experts along **5 unique axes**
to stress-test a decision, plan, or technical approach. Each axis is a
distinct lens — none of them duplicates another. If a panel can't keep the
5 distinct, reduce to fewer axes rather than collapse two.

## The 5 axes

| Axis | Lens | Asks |
| --- | --- | --- |
| **advocate** | Steelman — argue FOR | What's the strongest possible case for this proposal? What would its best advocate say? |
| **critic** | Argue AGAINST | What flaws, failure modes, hidden costs, weak assumptions exist? What would a hostile reviewer find? |
| **pragmatist** | Implementation reality (now) | Cost, time, complexity, dependencies. What does day-to-day operation look like? |
| **historian** | Past precedents | What worked / didn't before? What does ke or the literature say about analogous decisions? |
| **futurist** | Long-term implications | Second-order effects, scaling, lock-in. What does this commit us to in 6 months / 2 years? |

The axes are orthogonal: advocate vs critic = direction; pragmatist vs futurist = time horizon; historian = precedent vs the proposal itself. No axis is "find weaknesses" twice, and no axis is "think long-term" twice.

## Workflow

### Round 1: Independent Investigation + Opening Arguments

1. **Spawn 5 expert sub-sessions** in parallel — one per axis above.
   Each session takes the role assigned; none may overlap into another axis.

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
