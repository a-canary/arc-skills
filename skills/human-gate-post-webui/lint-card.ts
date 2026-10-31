// lint-card.ts — reject a /decide card before it is posted (SKILL.md §2).
// Same parse rules as arc-webui src/dashboards/decide.ts parseDecide, plus the
// caps from the 2026-10-31 review of 26 cards (14 had no decision, 19 no rec,
// 16 led with ids/SHAs/paths; the operator pushed back on long ones).
// Usage: bun lint-card.ts "<title>" <body-file>   → exit 1 + reasons on stderr.

const SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const PATH = /(?:~|\.{0,2})\/[\w.-]+\/|\b[\w-]+\.(?:ts|sh|md|json|py)\b/;
// ponytail: bead ids (repos-otgb) are not flagged — no prefix list; add one if they keep leaking into titles.

export function lintCard(title: string, body: string): string[] {
  const err: string[] = [];
  const plain = (where: string, s: string) => {
    if (SHA.test(s)) err.push(`${where}: no commit SHAs`);
    if (PATH.test(s)) err.push(`${where}: no file paths`);
  };
  if (title.length > 70) err.push(`title: ${title.length} chars, max 70`);
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
  return err;
}

if (import.meta.main) {
  const [title, file] = Bun.argv.slice(2);
  if (!title || !file) { console.error('usage: bun lint-card.ts "<title>" <body-file>'); process.exit(2); }
  const err = lintCard(title, await Bun.file(file).text());
  for (const e of err) console.error(`card: ${e}`);
  process.exit(err.length ? 1 : 0);
}
