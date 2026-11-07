---
name: deploy-agent
description: Runs, as root, the commands agents would otherwise ask the operator to run. DRY-RUN ONLY until repos-vlqa lands. Use when you need a privileged command executed and have a /decide card for it.
---

# Deploy Agent

Replaces "please run this as root" chat asks with a pinned script on a /decide card.
Approved in cards arc-3nr and repos-dnc1.

## Status: dry-run only

Root execution is NOT enabled.
`verifyOperator()` in `deploy-run.ts` is a stub returning `{ok:false, why:"pending repos-vlqa"}`.
Agents can forge `bd comments add --author operator`, so an accept is not yet proof.
The execute branch (`sudo -n bash <script>`, then a changes-log entry) exists but is unreachable.

## Usage

1. Write the script with a `# undo: <cmd>` line.
2. Post the card: `bun skills/human-gate-post-webui/decide.ts ask|task ... --run ./script.sh`.
   The script is copied to `~/vault/director/deploy-queue/<sha8>-<name>` and `Run: <path> sha256: <hex>` is appended after `</decide>`.
3. After the operator accepts: `bun skills/deploy-agent/deploy-run.ts <card-id> [--repo R]`.

## Checks (any failure: one-line reason, exit 3)

- Last DECISION comment is `accept`.
- `Run:` path is under the deploy queue and the sha256 matches the file.
- Script has a `# undo:` line.
- Script text matches no regex in `fences.txt`.

## Fence list (`fences.txt`, one regex per line)

~/.claude hooks and settings, /etc/sudoers and sudoers.d, GLOBAL-RULES.md, skills/deploy-agent/, vault/director/hooks, write-lane, label-gate, `chmod ... /etc`, visudo, disabling cron or systemd for guard services.

## Test

`bun test skills/deploy-agent skills/human-gate-post-webui`
