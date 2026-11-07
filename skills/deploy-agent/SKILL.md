---
name: deploy-agent
description: Runs, as root, the commands agents would otherwise ask the operator to run, once the operator accepts the /decide card that pins them. Use when you need a privileged command executed and have a /decide card for it.
---

# Deploy Agent

Replaces "please run this as root" chat asks with a pinned script on a /decide card.
Approved in cards arc-3nr and repos-dnc1.

## Trust model (repos-vlqa, answer C: no proof, fences only)

Root execution is live.
An accept counts when the card's last DECISION comment is `accept` and its author is `operator`.
That author field is forgeable by any agent; the operator accepted that risk because webui already requires a key.
Upgrade path: webui signs card id + script sha256 on accept, and deploy-run.ts verifies the signature.

## Usage

1. Write the script with a `# undo: <cmd>` line.
2. Post the card: `bun skills/human-gate-post-webui/decide.ts ask|task ... --run ./script.sh`.
   The script is copied to `~/vault/director/deploy-queue/<sha8>-<name>` and `Run: <path> sha256: <hex>` is appended after `</decide>`.
3. After the operator accepts: `bun skills/deploy-agent/deploy-run.ts <card-id> [--repo R]`.
   `--dry` prints the plan without running it.
   Before running it appends what will run and its undo to the week's changes log, then the exit code after.

## Checks (any failure: one-line reason, exit 3)

- Card is not closed.
- Last DECISION comment is `accept` with option A or none (B+ such as "Skip" never run), authored `operator`.
- The last `Run:` line after `</decide>` is the pin; its path is under the deploy queue and the sha256 matches the file.
- Re-pinning a fixed script means a new card (`--replaces`), never `bd update` on the accepted one.
- Only `--repo` and `--dry` are accepted flags; a misspelled flag refuses rather than running.
- Script has a `# undo:` line.
- Script text matches no regex in `fences.txt`.

## Fence list (`fences.txt`, one regex per line)

~/.claude hooks and settings, /etc/sudoers and sudoers.d, GLOBAL-RULES.md, skills/deploy-agent/, vault/director/hooks, write-lane, label-gate, `chmod ... /etc`, visudo, disabling cron or systemd for guard services.
Also eval, base64 decode, pipe-to-shell and curl/wget (no unpinned code).

Fences catch mistakes, not attackers: text regexes are easy to evade.
The real guards are the sha256 pin, running the hashed bytes (`bash -c`, stdin closed) rather than the path, and the operator reading the card before accepting.

## Test

`bun test skills/deploy-agent skills/human-gate-post-webui`
