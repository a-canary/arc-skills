#!/usr/bin/env bun
/**
 * counsel/orchestrate.js
 * Spawns 5 expert sub-sessions, runs 2 rounds, aggregates findings.
 * 
 * Usage:
 *   ./orchestrate.js "Should we migrate to Postgres?" ~/context.md
 *   ./orchestrate.js --topic "Architecture decision" --context ./docs/adr-042.md
 */

import { exists } from "fs";

const EXPERTS = ["skeptic", "pragmatist", "strategist", "historian", "devil-advocate"];

interface Expert {
  name: string;
  domain: string;
  focus: string;
}

const PANEL: Expert[] = [
  { name: "skeptic", domain: "Critical Analysis", focus: "Assumptions, failure modes, edge cases" },
  { name: "pragmatist", domain: "Implementation", focus: "Feasibility, complexity, timelines, tech debt" },
  { name: "strategist", domain: "Long Game", focus: "Alignment with goals, second-order effects" },
  { name: "historian", domain: "Pattern Matching", focus: "Past decisions, lessons learned, recurring themes" },
  { name: "devil-advocate", domain: "Opposition Research", focus: "Steelman the alternative, find the better option" },
];

function buildExpertPrompt(expert: Expert, topic: string, context: string, round: number, allArgs?: string): string {
  const roundInstructions = round === 1
    ? `This is Round 1: Independent investigation and opening argument.

Your workflow:
1. Run ke:recall to find relevant past knowledge about: ${topic}
2. Read any relevant files (check ~/vault/ke/, project docs, ADRs)
3. Present your opening argument (max 5 sentences)

Opening argument format:
## ${expert.name.toUpperCase()} (${expert.domain})
**Focus:** ${expert.focus}

[Your argument here]`
    : `This is Round 2: Cross-examination and rebuttal.

Your workflow:
1. Review the other experts' arguments from Round 1
2. Find the weakest argument and challenge it
3. Refine your own position based on new information
4. Present your rebuttal (max 5 sentences)

${allArgs ? `## Round 1 Arguments (for cross-examination)\n${allArgs}\n` : ""}
Rebuttal format:
## ${expert.name.toUpperCase()} (${expert.domain}) — Round 2

**Responding to:** [weakest argument]
**My refined stance:** [2-3 sentences]`;

  return `# Expert Panel: ${topic}

You are ${expert.name}, a domain expert in ${expert.domain}.
Your focus: ${expert.focus}

${context ? `## Context\n${context}\n` : ""}
## Topic Under Review
${topic}

${roundInstructions}

Remember: Be specific, cite evidence when possible, and keep arguments concise.`;
}

async function runExpertSession(expert: Expert, topic: string, context: string, round: number, allArgs?: string): Promise<string> {
  const prompt = buildExpertPrompt(expert, topic, context, round, allArgs);
  const outFile = `/tmp/counsel-${expert.name}-r${round}.md`;
  
  // Spawn claude with the expert prompt
  const proc = Bun.spawn(["claude", "-p", prompt, "--output-format", "json"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  
  const output = await new Response(proc.stdout).text();
  
  try {
    const parsed = JSON.parse(output);
    // Extract content from claude's response
    const content = parsed.content?.[0]?.text || parsed.message?.content || output;
    Bun.write(outFile, content);
    return content;
  } catch {
    // Fallback: save raw output
    Bun.write(outFile, output);
    return output;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let topic = "";
  let contextFile = "";
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--topic" || args[i] === "-t") {
      topic = args[++i];
    } else if (args[i] === "--context" || args[i] === "-c") {
      contextFile = args[++i];
    } else if (!args[i].startsWith("-")) {
      topic = args[i];
    }
  }
  
  if (!topic) {
    console.error("Usage: orchestrate.js --topic 'question' [--context file.md]");
    process.exit(1);
  }
  
  // Load context if provided
  let context = "";
  if (contextFile && await exists(contextFile)) {
    context = Bun.file(contextFile).text();
  } else if (contextFile) {
    console.warn(`Context file not found: ${contextFile}`);
  }
  
  console.log(`🎤 Counsel Session: ${topic}\n`);
  
  // Round 1: Parallel expert sessions
  console.log("=== ROUND 1: Opening Arguments ===\n");
  const round1Results: string[] = [];
  
  const round1Promises = PANEL.map(async (expert) => {
    console.log(`[${expert.name}] Investigating...`);
    const result = await runExpertSession(expert, topic, context, 1);
    console.log(`[${expert.name}] ✓`);
    return { expert: expert.name, result };
  });
  
  const round1Outputs = await Promise.all(round1Promises);
  for (const { expert, result } of round1Outputs) {
    round1Results.push(`### ${expert.toUpperCase()}\n${result}`);
  }
  
  const allRound1Args = round1Results.join("\n\n---\n\n");
  
  // Round 2: Sequential (for cleaner context) or parallel
  console.log("\n=== ROUND 2: Rebuttal ===\n");
  const round2Results: string[] = [];
  
  const round2Promises = PANEL.map(async (expert) => {
    console.log(`[${expert.name}] Rebutting...`);
    const result = await runExpertSession(expert, topic, "", 2, allRound1Args);
    console.log(`[${expert.name}] ✓`);
    return { expert: expert.name, result };
  });
  
  const round2Outputs = await Promise.all(round2Promises);
  for (const { expert, result } of round2Outputs) {
    round2Results.push(`### ${expert.toUpperCase()} (Final)\n${result}`);
  }
  
  // Synthesize report
  console.log("\n=== SYNTHESIZING ===\n");
  const synthesisPrompt = `# Synthesis Task

You are a synthesis expert. Given the following expert arguments over 2 rounds, produce a concise counsel report.

## Topic
${topic}

## Round 1 Arguments
${allRound1Args}

## Round 2 Arguments
${round2Results.join("\n\n---\n\n")}

## Output Format
Generate a report with:
1. **Consensus Points** - where N/5 experts agreed
2. **Key Disagreements** - substantive conflicts
3. **Strongest Arguments** - most compelling points
4. **Recommended Course of Action** - 3-5 concrete steps
5. **Dissenting Views** - minority opinions worth noting

Keep the report under 500 words. Focus on actionable recommendations.`;

  const reportResult = await fetch("http://localhost:8080/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: synthesisPrompt }),
  }).catch(() => null);

  // Fallback: just combine all arguments
  const finalReport = reportResult 
    ? await reportResult.text() 
    : `## Counsel Report: ${topic}

### Round 1 Arguments
${allRound1Args}

### Round 2 Arguments  
${round2Results.join("\n\n---\n\n")}

### Synthesis Needed
Run /skill:counsel with a claude instance to synthesize.`;

  const reportFile = `/tmp/counsel-report-${Date.now()}.md`;
  Bun.write(reportFile, finalReport);
  console.log(`\n✅ Report saved to: ${reportFile}`);
  console.log("\n" + finalReport);
}

main();
