---
name: to-prd
description: Turn the current conversation context into a PRD and publish it to the project issue tracker. Use when user wants to create a PRD from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

3. Write the PRD using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

<prd-template>

## Problem Statement
(user's perspective)

## Solution
(user's perspective)

## User Stories

Extensive numbered list covering all aspects, each `As an <actor>, I want a <feature>, so that <benefit>` — e.g. "As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed spending decisions."

## Implementation Decisions

Modules built/modified + their interfaces, dev clarifications, architectural/schema/API-contract decisions, specific interactions. NO file paths or code snippets — they go stale fast. Exception: a prototype snippet that encodes a decision more precisely than prose (state machine, reducer, schema, type shape) — inline the decision-rich bits within the relevant decision, note it came from a prototype.

## Testing Decisions

What makes a good test (test external behavior, not implementation details); which modules get tested; prior art (similar tests in the codebase).

## Out of Scope

## Further Notes

</prd-template>
