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
2. Post the card: `bun skills/human-gate-post-webui/decide.ts ask ... --run ./script.sh` (ask cards only, and the first `--opt` must be titled `Run ...`: accept A runs the script, so A must say so; decide.ts and deploy-run.ts both refuse otherwise).
   `--run` cards only for scripts that cross a `human-only.txt` line; everything else goes through a Lead grant (`--grant`, repos-jedj).
   The script is copied to `~/vault/director/deploy-queue/<sha8>-<name>` and `Run: <path> sha256: <hex>` is appended after `</decide>`.
3. After the operator accepts: `bun skills/deploy-agent/deploy-run.ts <card-id> [--repo R]`.
   `--dry` prints the plan without running it.
   `--as-user` runs it as you, without sudo: use it only when every step in the script is `sudo -u <you>` (no root step; a root step fails and `|| echo` would hide it).
   Root runs go through `/usr/local/sbin/deploy-root <sha256> <queue file>`, the one command the sudoers rule allows (operator-installed 2026-11-15, repos-vjpl; source and installer in `~/vault/director/scripts/`).
   The wrapper is root-owned: it copies the queue file into `/var/log/deploy-root/`, re-checks the hash, the undo line and its own fence list (`/etc/deploy-root/fences.txt`), logs the run, then runs the copy.
   It cannot check the accept: that stays here, in deploy-run.ts. So an agent could call the wrapper directly; what holds then is the root-owned fences and a record agents cannot erase.
   The root fence list is a copy: a change to `fences.txt` here reaches root only when the operator reinstalls it.
   Before running it appends what will run and its undo to the week's changes log, then the exit code after.

## Grant path: no card (repos-jedj, operator ruling 2026-11-16 23:10Z)

`bun skills/deploy-agent/deploy-run.ts --grant <lead> --script <queue path> [--dry] [--as-user]`
A Lead grants the run itself; no card is posted.
deploy-run has defend-attack review the exact script bytes and runs only on CLEAR, so no receipt can be brought from elsewhere.
Same queue-dir, undo-line and fence checks as a card run, plus `human-only.txt`, a text screen (not a guarantee): a script naming any `gh api` call, live trading, the order tool, force push, `--admin`, visibility/access or missions.md is refused and needs an operator card.

Known limits of the screen:
- Shell indirection is not caught: a variable holding `gh` or `api`, `cd tools && bun order`, backslash line continuations, eval.
- Broad by design: any line with `gh` then `api`, or `bun` then `order`, is refused even when benign (e.g. `bun test order.test.ts`); such a script goes through an operator card. False refusals cost a card; false passes cost the screen.
- Backstop: defend-attack review of the exact script bytes.
- Real ceiling: the judge gate (repos-oh6y).
The changes log records the granting Lead, the review verdict, the hash and the undo.
The reviewer runs with a fixed environment (home from /etc/passwd, fixed PATH), and reads its diff from a fresh 0700 directory there, so caller variables cannot swap it or its input.
Ceiling: these checks run as the agents' own user, so a process that rewrites `human-only.txt` or defend-attack, or calls `deploy-root` directly, skips them; the card path has the same ceiling.
What holds then is deploy-root's root-owned fences and its log. Upgrade: a root-owned human-only list and a review receipt checked inside deploy-root (master seat, repos-oh6y).

## Checks (any failure: one-line reason, exit 3)

- Card is not closed.
- Option A's title starts with `Run` (allow-list: a card whose A means Done, Answer or Not now never runs).
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
The crontab fence refuses only the remove flag; replacing the crontab from a file or stdin passes, because that is how cron lines are installed.
The real guards are the sha256 pin, running the hashed bytes (`bash -c`, stdin closed) rather than the path, and the operator reading the card before accepting.

## Test

`bun test skills/deploy-agent skills/human-gate-post-webui`
