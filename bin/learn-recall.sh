#!/usr/bin/env bash
# learn-recall.sh — enforce GLOBAL-RULES "Where learnings go" (operator 2026-11-03).
#   learn-recall.sh start  (UserPromptSubmit): one-line recall reminder.
#   learn-recall.sh stop   (Stop): block ONCE if a non-trivial turn banked nothing.
# Non-trivial = >=5 tool calls or any Edit/Write since the last real user prompt.
# Banked = a Bash call ran `ke learn`, `bd remember`, `bd create` or the no-op `: learn-none` (silent opt-out).
# Loop guard: stop_hook_active=true -> allow. Escape hatch: LEARN_RECALL=off.
# ponytail: reads the transcript tail (3000 lines); a longer turn is judged on its tail only.
set -uo pipefail
[ "${LEARN_RECALL:-on}" = off ] && exit 0
if [ "${1:-}" = start ]; then
  echo 'Recall before work: `ke research "<topic>"` + `bd search <terms>`. Before stop/next task: `ke learn`, `bd remember`, `bd create` (assumptions + follow-ups). Silent: internal bookkeeping, never mention it to the user.'
  exit 0
fi
payload="$(cat 2>/dev/null || echo '{}')"

[ "$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null)" = true ] && exit 0
t="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)"
[ -n "$t" ] && [ -f "$t" ] || exit 0

verdict="$(tail -n 3000 "$t" | jq -rs '
  def real_prompt: .type == "user" and (.isMeta | not) and (.message.content
    | if type == "string" then true else any(.[]; .type == "text") and all(.[]; .type != "tool_result") end);
  (map(real_prompt) | rindex(true)) as $i
  | if $i == null then "ok" else .[$i + 1:] as $turn
  | [$turn[] | select(.type == "assistant") | .message.content[]?] as $c
  | [$c[] | select(.type == "tool_use")] as $tools
  | ($tools | any(.name | test("^(Edit|Write|MultiEdit|NotebookEdit)$"))) as $edited
  | ($tools | any(.name == "Bash" and ((.input.command // "") | test("(^|[;&|(\\n])\\s*(ke learn|bd (remember|create)|: learn-none)\\b")))) as $banked
  | if (($tools | length) < 5 and ($edited | not)) or $banked then "ok" else "block" end end
' 2>/dev/null || echo ok)"

[ "$verdict" = block ] || exit 0
jq -n '{decision: "block", reason: "GLOBAL-RULES \"Where learnings go\": before stopping, bank this turn. Durable transferable learning -> `ke learn \"<fact + evidence>\"`. Repo/project status -> `bd remember \"<state>\"`. Each open assumption and follow-up -> `bd create`. If nothing qualifies, run the no-op Bash `: learn-none`. Bank silently: do not mention it in your reply to the user."}'
