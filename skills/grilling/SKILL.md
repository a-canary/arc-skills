---
name: grilling
description: Grill the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask each question as one /decide card ([human-gate-post-webui](../human-gate-post-webui/SKILL.md), `decide.ts ask`), never in chat. One decision per card; post independent branches together, and post a dependent question only after its parent is answered. Between answers, keep researching. Asking several things in one card is bewildering.

If a *fact* can be found by exploring the codebase, look it up rather than asking me. The *decisions*, though, are mine — put each one to me as a card, with your recommended answer as the first option, and read the reply with `decide.ts answers`.

Do not enact the plan until a final card confirms we have reached a shared understanding.
