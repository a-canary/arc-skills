// lint-card.ts — reject a /decide card before it is posted (SKILL.md §2).
// Same parse rules as arc-webui src/dashboards/decide.ts parseDecide, plus the
// caps from the 2026-10-31 review of 26 cards (14 had no decision, 19 no rec,
// 16 led with ids/SHAs/paths; the operator pushed back on long ones).
// Usage: bun lint-card.ts "<title>" <body-file>   → exit 1 + reasons on stderr.

const SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const PATH = /(?:^|\s)(?:~|\.{1,2})?\/[\w.-]+\/|\b[\w-]+\.(?:ts|sh|md|json|py)\b/;
// Bead ids leaked into titles (operator 2026-11-07: "I don't know ids and commit hashes").
// Id-shaped tokens are only candidates: the caller says which are real ids, so names like arc-webui pass.
export const ID_SHAPE = /(?<![\w-])[a-z][a-z0-9]*-[a-z0-9]{2,8}(?:\.\d+)*(?![\w-])/g;
// Operator format 2026-11-07: "[Design|Prototype|Deploy] {Recommendation headline}"; Task = a chore only the operator can do.
export const KINDS = ["Design", "Prototype", "Deploy", "Task"] as const;
const HEADLINE = new RegExp(`^\\[(?:${KINDS.join("|")})\\] \\S`);

export function lintCard(title: string, body: string, isBead: (token: string) => boolean = () => false): string[] {
  const err: string[] = [];
  const plain = (where: string, s: string) => {
    if (SHA.test(s)) err.push(`${where}: no commit SHAs`);
    if (PATH.test(s)) err.push(`${where}: no file paths`);
    const ids = (s.match(ID_SHAPE) ?? []).filter(isBead);
    if (ids.length) err.push(`${where}: no bead ids (${ids.join(", ")}); say what the item is in plain words`);
  };
  if (!HEADLINE.test(title)) err.push(`title: start with [${KINDS.join("|")}] then the recommendation headline`);
  if (title.length > 80) err.push(`title: ${title.length} chars, max 80`);
  plain("title", title);

  const s = body.indexOf("<decide>"), e = body.indexOf("</decide>");
  if (s < 0) return [...err, "no <decide> block: prose options get no buttons; no decision at all → not a human card (bd note your own bead)"];
  if (e < s) return [...err, "no </decide>"];
  const inner = body.slice(s + 8, e);
  if (inner.length > 900) err.push(`<decide> block: ${inner.length} chars, max 900 (move evidence after </decide>)`);

  const qs = [...inner.matchAll(/<q>([\s\S]*?)<\/q>/g)].map((m) => m[1]!.trim());
  if (qs.length !== 1) err.push(`${qs.length} <q>, need exactly 1`);
  const q = qs[0] ?? "";
  if (q && !q.endsWith("?")) err.push("<q> must end with ?");
  if ((q.match(/\?/g) ?? []).length > 1) err.push("<q>: one question only");
  if (q.length > 140) err.push(`<q>: ${q.length} chars, max 140`);
  plain("<q>", q);

  const ctx = /<context>([\s\S]*?)<\/context>/.exec(inner)?.[1]?.trim() ?? "";
  if (!ctx) err.push("<context> (--context) is required: it is the Problem line, what is wrong and why it matters");
  if (ctx.length > 400) err.push(`<context>: ${ctx.length} chars, max 400`);

  const opts = [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((m) => {
    const at = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]!)?.[1] ?? "";
    return { id: at("id"), title: at("title").trim(), body: m[2]!.trim(), rec: at("rec") === "1" };
  });
  if (opts.length < 2 || opts.length > 4) err.push(`${opts.length} options, need 2-4`);
  const ids = opts.map((o) => o.id);
  if (ids.some((id) => !/^[A-E]$/.test(id)) || new Set(ids).size !== ids.length) err.push("option ids must be unique A-E");
  const recs = opts.filter((o) => o.rec);
  if (recs.length !== 1) err.push(`${recs.length} rec="1", need exactly 1`);
  else if (opts[0] !== recs[0]) err.push("the rec option goes first");
  for (const o of opts) {
    if (!o.title || o.title.split(/\s+/).length > 5) err.push(`option ${o.id}: title needs 1-5 words`);
    if (o.body.length > 200) err.push(`option ${o.id}: ${o.body.length} chars, max 200`);
  }
  // repos-0f2e (operator 2026-11-16): each card names the judgement only the operator adds; running or re-approving reviewed work is not one.
  const after = body.slice(e + 9);
  const adds = /^Operator adds: (.+)$/m.exec(after)?.[1]?.trim() ?? "";
  if (adds.length < 20) err.push('"Operator adds:" line after </decide> is required: the judgement only the operator can add (direction, taste, risk, money, policy)');
  const PROXY = /\bre-?(?:accept|approve|run)\b|\brun (?:this|the|it) (?:reviewed|approved|cleared)\b|\b(?:type|paste) (?:this|the|that) (?:line|command)\b|\b(?:type|paste) (?:it|this) for me\b/i;
  const all = [title, q, adds, ...opts.flatMap((o) => [o.title, o.body])].join("\n");
  if (PROXY.test(all)) err.push("meat-proxy card: running or re-approving reviewed work adds nothing; fix the guard so the reviewed path runs by itself");
  // repos-jedj (operator 2026-11-16 23:10Z): cards are for taste, not permissions; a Lead grants permission after a review CLEAR.
  // Hard lines (money, live orders, force push, visibility/access, deletion, rules/missions) stay with the operator.
  const ASKS_PERMISSION = /\b(?:may|can) (?:i|we)\b|\bok(?:ay)? to\b|\bpermission\b|\bapprove\b|\bgo-ahead\b/i;
  // ponytail: a readability lint, not a guard: an author can still name a hard line falsely, and the operator reads the card.
  const HARD_LINE = /\$\d|\b(?:money|spend\w*|live orders?|force[- ]push\w*|(?:goes|go|make \w+) public|repo (?:visibility|access|deletion)|delete the repo|global-rules|choices\.md|mission change)\b/i;
  if (ASKS_PERMISSION.test(q) && !HARD_LINE.test(adds)) err.push("permission-only card: a Lead grants it (deploy-run --grant after a review CLEAR); a card carries direction, taste, priority or money");
  return err;
}

if (import.meta.main) {
  const [title, file] = Bun.argv.slice(2);
  if (!title || !file) { console.error('usage: bun lint-card.ts "<title>" <body-file>'); process.exit(2); }
  const err = lintCard(title, await Bun.file(file).text());
  for (const e of err) console.error(`card: ${e}`);
  process.exit(err.length ? 1 : 0);
}
