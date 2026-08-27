import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mdToHtml, render } from "./render-html.ts";

describe("render-html", () => {
  test("mdToHtml covers the constructs ontology docs use", () => {
    const md = [
      "# Title",
      "",
      "Para with `code`, **bold**, and [link](https://x.y).",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- item one",
      "- item two",
      "",
      "1. first",
      "2. second",
      "",
      "> quoted",
      "",
      "```",
      "fn x() {}",
      "```",
      "---",
    ].join("\n");
    const html = mdToHtml(md);
    expect(html).toContain("<h2 id=\"title\">Title</h2>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://x.y">link</a>');
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("fn x() {}");
    expect(html).toContain("<hr>");
  });

  test("render is deterministic and self-contained", () => {
    const dir = mkdtempSync(join(tmpdir(), "onto-render-"));
    writeFileSync(
      join(dir, "OVERVIEW.md"),
      "---\nsurveyed_at_sha: abc1234\nscope: [src/]\nstatus: stable\n---\n\n# Overview\n\nOne line.\n",
    );
    writeFileSync(join(dir, "topics.md"), "# Topics\n\n- t\n");
    const a = render(dir);
    const b = render(dir);
    expect(a).toBe(b); // deterministic
    expect(a).not.toMatch(/src=|<link|<script/); // no external assets
    expect(a).toContain("abc1234"); // certification stamp visible
    expect(a.indexOf('id="overview"')).toBeLessThan(a.indexOf('id="topics"')); // OVERVIEW first
  });

  test("render output writes a valid standalone file", () => {
    const dir = mkdtempSync(join(tmpdir(), "onto-render-cli-"));
    writeFileSync(join(dir, "OVERVIEW.md"), "# Overview\n");
    const html = render(dir);
    writeFileSync(join(dir, "ontology.html"), html);
    expect(readFileSync(join(dir, "ontology.html"), "utf8")).toContain("<h1>Ontology</h1>");
  });
});
