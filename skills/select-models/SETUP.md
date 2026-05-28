# select-models — Setup

**One-time install.** Run once after installing arc-skills; idempotent thereafter.

## What gets installed

Nothing is written until you invoke `/select-models` interactively. This SETUP.md only makes the skill discoverable by `setup-arc-skills`. The actual side-effect (writing `~/.config/arc-skills.json`) happens only when you run the skill and complete the interactive flow.

## Reversal

No files are written by SETUP.md itself. To undo the config written by the skill:

```bash
rm ~/.config/arc-skills.json
```
