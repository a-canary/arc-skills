# Setup

Dream runs in two phases on two models: a **fast** model pages the bulk of the
conversation logs (cheap, high-volume), and a **smart** model reads the distilled
journal and makes the single system edit. The skill itself is just markdown and
needs no install — but the two phases are custom subagents (`collector`,
`adapter`), and Claude Code only spawns subagents it can find in an agents
directory. So there is a one-time install:

## 1. Register the agents

The agent prompts ship at `skills/dream/agents/`. Symlink them where Claude Code
discovers subagents (`~/.claude/agents/`), so `/dream` can spawn `collector` and
`adapter` by name:

```bash
mkdir -p ~/.claude/agents
ln -sf ~/.claude/skills/dream/agents/collector.md ~/.claude/agents/collector.md
ln -sf ~/.claude/skills/dream/agents/adapter.md   ~/.claude/agents/adapter.md
```

(`~/.claude/skills/` is itself a symlink into this repo, so the agent files
track the repo — edit once, installed everywhere.)

## 2. Configure a fast and a smart model

The agent files name their models in frontmatter:

- `collector.md` → `model: minimax` — the **fast** model. Bulk paging is the
  expensive part by volume, so this should be a cheap, high-throughput model.
- `adapter.md` → `model: opus` — the **smart** model. It makes exactly one
  edit, so spend the capable model here.

`opus` is a built-in Claude model and works as-is. `minimax` is a custom alias:
Claude Code must be configured to route `model: minimax` to a provider model.
If your setup has no such alias, either:

- point `collector.md`'s `model:` at a built-in you consider "fast enough"
  (e.g. `haiku`), or
- configure a custom model alias named `minimax` in your Claude Code settings.

Either way the rule holds: **fast model collects, smart model adapts.** If both
phases run on one model the skill still works — it just costs more, since the
high-volume paging no longer runs on the cheap model.

## 3. (Optional) Nightly cron

Dream is incremental (`scripts/pipeline.py` tracks processed sessions by mtime),
so it is safe to run unattended. To work the backlog down nightly, point a
system cron entry at a wrapper that invokes `/dream`. Keep `--limit` in place so
a cold start can't spawn thousands of agents in one tick.
