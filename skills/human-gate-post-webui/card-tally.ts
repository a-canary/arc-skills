// card-tally — count cards/day by kind (decision vs mechanical) to measure the
// meat-proxy share (repos-0f2e item 4). Target: zero mechanical cards.
//
// Reads decided cards from the bead store and classifies each by whether it
// would have failed the meat-proxy lint. Reports count per day.
//
// Usage: bun card-tally.ts [--days N]
import { execSync } from "node:child_process";

const HOME = process.env.HOME ?? "/home/aaron";

function parseArgs(argv: string[]): { days: number } {
  let days = 7;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days" && argv[i + 1]) days = parseInt(argv[++i]!, 10);
  }
  return { days };
}

// Meat-proxy regex from lint-card.ts
const PROXY = /\bre-?(?:accept|approve|run)\b|\brun (?:this|the|it) (?:reviewed|approved|cleared)\b|\b(?:type|paste) (?:this|the|that) (?:line|command)\b|\b(?:type|paste) (?:it|this) for me\b/i;

function isMechanical(title: string, body: string): boolean {
  return PROXY.test(`${title}\n${body}`);
}

// Get all decided cards from the bead store
function getDecidedCards(): Array<{ id: string; title: string; body: string; created: string }> {
  try {
    const out = execSync("cd ~/repos && bd list --status closed --json --limit 500 2>/dev/null", { shell: true, encoding: "utf8" });
    const cards = JSON.parse(out);
    if (!Array.isArray(cards)) return [];
    return cards
      .filter((c: any) => c.labels?.includes("human") || c.labels?.includes("decided"))
      .map((c: any) => ({
        id: c.id,
        title: c.title ?? "",
        body: c.description ?? "",
        created: c.created_at ?? c.updated_at ?? "",
      }));
  } catch {
    return [];
  }
}

function main() {
  const { days } = parseArgs(process.argv.slice(2));
  const cards = getDecidedCards();
  
  // Filter to last N days
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = cards.filter((c) => {
    const ts = new Date(c.created).getTime();
    return ts >= cutoff;
  });

  // Classify
  let decision = 0;
  let mechanical = 0;
  const mechanicalCards: Array<{ id: string; title: string }> = [];
  
  for (const c of recent) {
    if (isMechanical(c.title, c.body)) {
      mechanical++;
      mechanicalCards.push({ id: c.id, title: c.title });
    } else {
      decision++;
    }
  }

  const total = decision + mechanical;
  const share = total > 0 ? (mechanical / total) * 100 : 0;

  console.log(`Card tally (last ${days} days):`);
  console.log(`  Total: ${total}`);
  console.log(`  Decision: ${decision}`);
  console.log(`  Mechanical: ${mechanical} (${share.toFixed(1)}%)`);
  
  if (mechanicalCards.length > 0) {
    console.log(`\nMechanical cards:`);
    for (const c of mechanicalCards) {
      console.log(`  ${c.id}: ${c.title.slice(0, 80)}`);
    }
  }
}

main();
