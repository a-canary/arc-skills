---
name: blog
description: Pre-PR. Draft a blog/reddit-style entry for ~/web-demo/index.html from the staged diff (or current branch vs base) so the demo artifact gets reviewed alongside the code. Not a post-commit auto-poster.
---

# blog

Before opening a PR, draft an entry that shows what changed, why it matters, and one visual artifact. Land it in `~/web-demo/index.html` (or the configured demo root) on the same branch as the code so a reviewer sees the diff *and* the demo together.

This is a **pre-PR** skill, not a setup or post-commit skill. It runs against staged changes or the branch's diff vs its base — not against `HEAD` after the fact.

## When to invoke

- After feature work is done, before `gh pr create`.
- On a WIP branch when you want a visible "what this will demo as" preview.
- Re-run after addressing review feedback if the artifact would change.

## When NOT to invoke

- Doc-only or typo PRs. Skip — feed becomes noise.
- Internal refactor with no observable change. Skip.
- After the PR is merged (too late to review the artifact alongside the code).
- Sensitive changes (credentials, internal infra).

## Invocation

```bash
blog                    # draft from staged diff or branch-vs-base, into web-demo
blog --base main        # explicit base for branch diff
blog --skip "reason"    # mark this branch as intentionally not-blogged
blog --dry-run          # print the proposed entry, do not write
blog --publish          # after the entry lands, push web-demo to public host
blog --serve            # start the local server (idempotent)
```

## Procedure

```
1. Resolve the diff:
   - if staged changes exist: use `git diff --cached`
   - else: use `git diff <base>...HEAD` (base = --base, else upstream, else main)
   - capture: subject (from last commit or branch name), files changed, stat

2. Pick ONE visual artifact, in priority order:
   a. New/modified image files in the diff (*.png, *.jpg, *.svg, *.webp)
   b. New/modified HTML → headless-browser screenshot
   c. UI component diff (*.tsx, *.vue, *.svelte) → screenshot the dev server
   d. Diagram source (*.mmd, *.dot, *.puml) → render
   e. CLI tool added/changed → capture `--help` output as <pre>
   f. Benchmark/eval output in the diff → render as SVG chart
   g. None → ask the user: capture one, or --skip?

3. Copy artifacts into <demo-root>/assets/<short-sha-or-branch>-<n>.<ext>
   Keep < 500KB. Resize if larger. Prefer WebP/compressed JPEG over PNG.

4. Build the entry:
   - title: PR subject (or branch name humanized)
   - meta: repo · short-sha-or-branch · YYYY-MM-DD
   - why: 1-3 sentences from PR body / commit body / branch description
   - artifact(s) inline
   - footer: permalink + PR link placeholder (filled by gh pr create)

5. Insert <article> at the top of <main> in <demo-root>/index.html.
   Idempotent: replace any existing entry with same data-commit / data-branch.

6. Print: "Drafted. Review at http://<demo-host>:<port>/#post-<id>.
          Stage the artifact + index.html before `gh pr create`."

7. If --publish: rsync <demo-root>/ to $ARC_DEMO_HOST after PR merges.
```

## Entry shape

```html
<article class="post" id="post-<id>" data-commit="<sha-or-branch>" data-repo="<repo>" data-ts="<iso>">
  <header>
    <h2><a href="#post-<id>"><title></a></h2>
    <div class="meta"><repo> · <sha-or-branch> · <YYYY-MM-DD></div>
  </header>
  <div class="why"><1-3 sentences></div>
  <div class="artifacts">
    <object type="image/svg+xml" data="assets/<id>-<n>.svg"></object>
    <pre class="diff-stat"><git diff --stat output, trimmed></pre>
  </div>
  <footer>
    <a href="#post-<id>">permalink</a>
    <a href="<PR-URL>">PR</a>
  </footer>
</article>
```

Density: reddit/HN — title, meta, one-paragraph why, artifact inline. No reading-room whitespace.

## Bootstrapping the demo root

First run writes:

```
<demo-root>/
├── index.html       # shell with <main> + entry marker comment
├── style.css        # density-first, dark-mode default
├── script.js        # filter input + jump-to-permalink
└── assets/          # per-entry artifacts
```

`<demo-root>` defaults to `~/web-demo`. Override with `$ARC_DEMO_ROOT`.

## Hosting

| Mode | Default | Notes |
|---|---|---|
| local | on demand | `python3 -m http.server <port> --bind 0.0.0.0` from demo root. Picks the first free port from 8087, 8088, 8089. Manages a PID file at `~/.cache/arc-skills/blog-server.pid`. |
| public | off | `--publish` rsyncs to `$ARC_DEMO_HOST`. Per-PR opt-in. |

Why not :8080: too commonly held by other dev servers. The skill scans and picks the next free port; it never stomps an existing listener.

## What's a "visual artifact"

Generous:
- screenshots (UI, dashboards)
- diagrams (architecture, sequence, flow)
- terminal recordings (asciinema SVG)
- before/after splits
- charts (perf, leaderboards)
- code diffs themselves when the change *is* the demo

Anti-definition: walls of text, raw JSON dumps, unannotated logs. If it wouldn't make sense to someone scrolling the feed, it isn't an artifact.

## Anti-patterns

- Drafting an entry for every PR regardless of value — feed becomes noise. Use `--skip` liberally.
- Auto-publishing without review — the whole point is to review the artifact alongside the code.
- Running this *after* merge — too late to influence the PR.
- Embedding artifacts as base64 in `index.html` — file bloats; always use the assets dir.
- Lossless PNG screenshots — use WebP/JPEG; feed loads faster.
