---
name: demo
description: After a commit, append a blog/reddit-style entry to ~/web-demo/index.html showcasing the change with visual artifacts. Local host by default, --publish opt-in.
---

# demo

Every commit should be demoable. This skill maintains `~/web-demo/index.html` as a chronological feed — newest commit on top — with each entry showing what changed, why it matters, and one or more visual artifacts (screenshot, diagram, GIF, ASCII output).

If a commit has no visual artifact, the skill says so and asks whether to capture one or skip.

## Invocation

```bash
demo                       # after a commit in any repo; auto-detect HEAD commit
demo --commit <sha>        # use a specific commit
demo --skip                # mark current commit as intentionally not-demoed
demo --publish             # also push ~/web-demo/ to the public host
demo --serve               # start the local server (if not already running)
demo backfill --since <date>   # generate entries for past commits
```

## What an entry looks like

Each entry in `index.html` is a self-contained `<article>`:

```html
<article class="post" data-commit="abc1234" data-repo="arc-skills" data-ts="2026-05-22T21:00:00Z">
  <header>
    <h2>Add /demo skill for visual commit feed</h2>
    <div class="meta">arc-skills · abc1234 · 2026-05-22</div>
  </header>
  <div class="why">
    Every commit should be demoable. This adds a skill that maintains
    ~/web-demo/index.html as a blog-style feed of recent work.
  </div>
  <div class="artifacts">
    <img src="assets/abc1234-screenshot.png" alt="demo index">
    <pre class="diff-stat">3 files changed, 287 insertions(+)</pre>
  </div>
  <footer>
    <a href="#post-abc1234">permalink</a>
    <a href="https://github.com/.../commit/abc1234">commit</a>
  </footer>
</article>
```

Style: reddit/HN-density default — title, repo+sha+date meta, one-paragraph why, artifacts inline. No reading-room whitespace.

## Procedure

```
1. Read HEAD commit: sha, subject, body, diff-stat, repo name, timestamp.

2. Look for visual artifacts in priority order:
   a. New/modified image files in the commit (*.png, *.jpg, *.svg, *.gif)
   b. New/modified HTML files → screenshot via headless browser
   c. Diff in a .tsx/.vue/.svelte UI component → screenshot the dev server
   d. Diff in a diagram source (*.mmd, *.dot, *.puml) → render it
   e. CLI tool added/changed → capture `--help` output
   f. None of the above → ask the user: capture or skip?

3. Copy artifacts into ~/web-demo/assets/<sha>-<n>.<ext>
   Keep them small (<500KB each). If larger, resize.

4. Build the entry from commit subject (title), commit body (why),
   diff-stat (footer), and artifacts.

5. Insert <article> at the top of <main> in ~/web-demo/index.html.
   Idempotent: if data-commit="<sha>" exists, replace instead of insert.

6. Print the local URL (http://home-lab-1:8080/#post-<sha>).

7. If --publish: rsync ~/web-demo/ to the configured public host.
```

## Bootstrapping ~/web-demo/

On first run, the skill writes:

```
~/web-demo/
├── index.html       # shell with empty <main>, includes style + script
├── style.css        # density-first, dark-mode default
├── script.js        # filter by repo, search, jump-to-permalink
└── assets/          # commit artifacts go here
```

The shell HTML has a single `<main>` block with the comment `<!-- entries inserted here, newest first -->`. The skill always inserts immediately after that comment.

## Hosting

| Mode | Default | Notes |
|---|---|---|
| local | on | `python3 -m http.server 8080 --bind 0.0.0.0` from `~/web-demo/`. Binds tailscale0-accessible interface so you can browse from any device on your tailnet. Idempotent — checks for existing listener on :8080 first. |
| public | off | `--publish` rsyncs to `${ARC_DEMO_HOST:-}` (e.g. a GitHub Pages repo or static host). Per-commit opt-in. |

The local server runs as a long-lived background process. The skill manages it via a PID file at `~/.cache/arc-skills/demo-server.pid` so `demo --serve --stop` works.

## What's a "visual artifact"

Generous definition:
- screenshots (UI, dashboards)
- diagrams (architecture, sequence, flow)
- terminal recordings (`asciinema` SVG)
- before/after comparisons (split-image)
- charts (perf graphs, leaderboards)
- code diffs themselves (syntax-highlighted, when the change *is* the demo)

Anti-definition: walls of text, raw JSON dumps, unannotated logs. If the artifact wouldn't make sense to someone scrolling the feed, it's not a demo artifact.

## When NOT to invoke

- Doc-only commits (typos, README polish). Use `--skip` to mark and move on.
- Internal refactor with no observable change. Use `--skip`.
- Sensitive commits (credentials moved, internal infra). Definitely skip.

## Anti-patterns

- Generating screenshots for every commit regardless of value (the feed becomes noise).
- Auto-publishing every commit (no editorial filter).
- Embedding artifacts as base64 in `index.html` (file bloats unboundedly; use the assets dir).
- Using lossless PNG for screenshots (use WebP or compressed JPEG; the feed loads faster).
