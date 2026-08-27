#!/usr/bin/env bun
// render-html — deterministic, self-contained HTML rendering of an ontology dir.
// Single output file: inline CSS, no external assets, no timestamps.
// Usage: bun render-html.ts [docsDir] [--out file]   (defaults: docs/ontology -> docs/ontology/ontology.html)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** Minimal deterministic markdown -> HTML: h1-h4, hr, tables, lists, blockquote, fenced code, paragraphs. */
export function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; // skip closing fence
      html.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length + 1; // # -> h2 (h1 reserved for page title)
      html.push(`<h${n} id="${esc(h[2].toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      html.push(
        "<table><thead><tr>" +
          head.map((c) => `<th>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>",
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, "")));
        i++;
      }
      html.push(`<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d+\.\s+/, "")));
        i++;
      }
      html.push(`<ol>${items.map((x) => `<li>${x}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) buf.push(lines[i++].slice(2));
      html.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|```|\||\s*[-*]\s|\s*\d+\.\s|> )/.test(lines[i])) buf.push(lines[i++]);
    html.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return html.join("\n");
}

function parseFrontmatterMeta(md: string): { sha?: string; scope?: string; status?: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const get = (k: string) => m[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return { sha: get("surveyed_at_sha"), scope: get("scope"), status: get("status") };
}

export function render(docsDir: string): string {
  const files = readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => (a === "OVERVIEW.md" ? -1 : b === "OVERVIEW.md" ? 1 : a.localeCompare(b)));
  const sections = files.map((f) => {
    const md = readFileSync(join(docsDir, f), "utf8");
    const meta = parseFrontmatterMeta(md);
    const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const stamp = meta.sha
      ? `<p class="stamp">certified at <code>${esc(meta.sha)}</code>${meta.status ? ` · ${esc(meta.status)}` : ""}${meta.scope ? ` · scope ${esc(meta.scope)}` : " · scope: whole repo (fail-closed)"}</p>`
      : "";
    return `<section id="${f.replace(".md", "").toLowerCase()}">\n${mdToHtml(body)}\n${stamp}\n</section>`;
  });
  const nav = files.map((f) => `<a href="#${f.replace(".md", "").toLowerCase()}">${esc(f)}</a>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ontology</title>
<style>
:root { --fg: #1a1a1a; --muted: #666; --line: #ddd; --code-bg: #f4f4f4; }
@media (prefers-color-scheme: dark) { :root { --fg: #e5e5e5; --muted: #999; --line: #333; --code-bg: #222; } }
body { font: 16px/1.6 system-ui, -apple-system, sans-serif; color: var(--fg); max-width: 860px; margin: 0 auto; padding: 2rem 1rem; }
h1 { border-bottom: 2px solid var(--line); padding-bottom: .3rem; }
h2 { margin-top: 2.5rem; border-bottom: 1px solid var(--line); padding-bottom: .2rem; }
nav.toc { background: var(--code-bg); border-radius: 6px; padding: .8rem 1.2rem; display: flex; flex-wrap: wrap; gap: .4rem 1rem; }
nav.toc a { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--muted); }
section { margin-top: 2rem; }
pre { background: var(--code-bg); padding: .8rem; overflow-x: auto; border-radius: 6px; }
code { background: var(--code-bg); padding: .1rem .3rem; border-radius: 3px; font-size: .9em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid var(--line); padding: .4rem .6rem; text-align: left; }
th { background: var(--code-bg); }
blockquote { border-left: 3px solid var(--line); margin-left: 0; padding-left: 1rem; color: var(--muted); }
.stamp { color: var(--muted); font-size: .85em; margin-top: 1.2rem; border-top: 1px dashed var(--line); padding-top: .4rem; }
</style>
</head>
<body>
<h1>Ontology</h1>
<p class="stamp">An ontology is a hint to verify, never ground truth.</p>
<nav class="toc">
${nav}
</nav>
${sections.join("\n<hr>\n")}
</body>
</html>
`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  const positional = argv.filter((a, i) => a !== "--out" && (outIdx < 0 || i !== outIdx + 1));
  const docsDir = resolve(positional[0] ?? "docs/ontology");
  const target = out ? resolve(out) : join(docsDir, "ontology.html");
  writeFileSync(target, render(docsDir));
  console.log(`rendered ${target}`);
}
