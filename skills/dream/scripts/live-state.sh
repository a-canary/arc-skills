#!/usr/bin/env bash
# live-state — answer "is this surface actually wired into the running system?"
# in ONE call, instead of the dozen hand calls (read cron file, read hook, grep
# codebase, infer wiring) the journal shows agents repeatedly burning.
#
# Reference promotion (dream loop): collapses the recurring expensive-gather
# pattern "acting on assumed system state without a cheap live-state check"
# — systemctl(23) / systemd(16) / is-active(8) / crontab -l(5) / hook-never-
# registered(2) across the journal — from ~12 tool calls to 1.
#
# L0-safe: pure bash + tools that already exist on the box (systemctl, crontab,
# grep, python3 stdlib). No new dependency — it sits at the boundary the
# self-healing loop relies on, so it must not itself need optimization.
#
# Usage:
#   live-state.sh <surface>          # auto-detect kind, report wired/dead
#   live-state.sh unit <name>        # systemd unit (user + system)
#   live-state.sh cron <pattern>     # crontab entry matching pattern
#   live-state.sh hook <name>        # hook script: on disk AND registered in settings.json
#   live-state.sh <name> --json      # machine-readable for the adapter
#
# Exit 0 = wired/live, 1 = dead/unregistered, 2 = ambiguous/not-found.
# The point: the agent reads ONE result, then applies its OWN judgment.
# This tool gathers; it does not decide.

set -uo pipefail

SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
HOOKS_DIR="${CLAUDE_HOOKS_DIR:-$HOME/.claude/hooks}"
JSON=0
KIND=""
ARG=""

# --- arg parse ---------------------------------------------------------------
for a in "$@"; do
  case "$a" in
    --json) JSON=1 ;;
    unit|cron|hook) [ -z "$KIND" ] && KIND="$a" || ARG="$a" ;;
    *) ARG="$a" ;;
  esac
done

if [ -z "$ARG" ]; then
  echo "usage: live-state.sh [unit|cron|hook] <name-or-pattern> [--json]" >&2
  exit 2
fi

# auto-detect kind when not given
if [ -z "$KIND" ]; then
  case "$ARG" in
    *.service|*.timer|*.socket) KIND="unit" ;;
    *.sh|*hook*)                KIND="hook" ;;
    *)                          KIND="cron" ;;  # default to the most-hit surface
  esac
fi

emit() { # status detail refs...
  local status="$1"; shift
  local detail="$1"; shift
  if [ "$JSON" -eq 1 ]; then
    python3 - "$KIND" "$ARG" "$status" "$detail" "$@" <<'PY'
import json,sys
kind,arg,status,detail,*refs = sys.argv[1:]
print(json.dumps({"surface":arg,"kind":kind,"status":status,"detail":detail,"refs":refs}))
PY
  else
    echo "surface : $ARG"
    echo "kind    : $KIND"
    echo "status  : $status"
    echo "detail  : $detail"
    for r in "$@"; do echo "ref     : $r"; done
  fi
  case "$status" in
    wired|live)        exit 0 ;;
    dead|unregistered) exit 1 ;;
    *)                 exit 2 ;;
  esac
}

# --- unit --------------------------------------------------------------------
check_unit() {
  local name="$1" found="" sys_state="" usr_state=""
  sys_state="$(systemctl is-active "$name" 2>/dev/null || true)"
  usr_state="$(systemctl --user is-active "$name" 2>/dev/null || true)"
  local sys_known usr_known
  systemctl cat "$name"        >/dev/null 2>&1 && sys_known=1 || sys_known=0
  systemctl --user cat "$name" >/dev/null 2>&1 && usr_known=1 || usr_known=0

  if [ "$sys_known" -eq 0 ] && [ "$usr_known" -eq 0 ]; then
    emit "dead" "no such unit in system or --user scope (not installed)"
  fi
  local scope="system"; [ "$usr_known" -eq 1 ] && scope="--user"
  local state="$sys_state"; [ "$usr_known" -eq 1 ] && state="$usr_state"
  if [ "$state" = "active" ]; then
    emit "wired" "active in $scope scope" "scope=$scope"
  else
    emit "wired" "installed in $scope scope but state=$state (enabled-but-not-running counts as wired)" "scope=$scope" "state=$state"
  fi
}

# --- cron --------------------------------------------------------------------
check_cron() {
  local pat="$1" hits
  hits="$( { crontab -l 2>/dev/null; } | grep -vE '^\s*#' | grep -F -- "$pat" )"
  if [ -n "$hits" ]; then
    # Pass each whole matching line as ONE arg — never word-split (a `*` in the
    # schedule would glob-expand against $HOME and dump the home listing, which
    # is the exact context-pollution this tool exists to prevent).
    local -a refs=()
    while IFS= read -r line; do
      [ -n "$line" ] && refs+=("entry=$line")
    done <<< "$hits"
    emit "wired" "matched in active crontab" "${refs[@]}"
  else
    emit "dead" "no uncommented crontab entry matches '$pat' (investigation of it is moot)"
  fi
}

# --- hook --------------------------------------------------------------------
# A hook is only LIVE if it (a) exists on disk AND (b) is referenced in
# settings.json. On-disk-but-unregistered is the exact "dead code / hook never
# registered" trap the journal records.
check_hook() {
  local name="$1" on_disk="" registered=""
  if [ -e "$HOOKS_DIR/$name" ]; then on_disk="$HOOKS_DIR/$name"
  else on_disk="$(find "$HOOKS_DIR" -maxdepth 1 -name "*$name*" 2>/dev/null | head -1)"; fi

  registered="$(python3 - "$SETTINGS" "$name" <<'PY' 2>/dev/null
import json,sys
try:
    d=json.load(open(sys.argv[1])); name=sys.argv[2]
except Exception:
    sys.exit(0)
hits=[]
for ev,groups in (d.get("hooks") or {}).items():
    for g in groups:
        for h in g.get("hooks",[]):
            if name in (h.get("command","") or ""):
                hits.append(f"{ev}:{h.get('command')}")
print("\n".join(hits))
PY
)"

  if [ -z "$on_disk" ] && [ -z "$registered" ]; then
    emit "dead" "hook '$name' not on disk and not in settings.json (does not exist)"
  elif [ -n "$on_disk" ] && [ -z "$registered" ]; then
    emit "unregistered" "script exists at $on_disk but is NOT referenced in settings.json — dead code, never fires" "disk=$on_disk"
  elif [ -z "$on_disk" ] && [ -n "$registered" ]; then
    emit "dead" "registered in settings.json but script missing on disk — broken reference" "$registered"
  else
    # shellcheck disable=SC2046
    emit "wired" "on disk AND registered" "disk=$on_disk" $(printf '%s\n' "$registered" | sed 's/^/reg=/')
  fi
}

case "$KIND" in
  unit) check_unit "$ARG" ;;
  cron) check_cron "$ARG" ;;
  hook) check_hook "$ARG" ;;
  *)    echo "unknown kind: $KIND" >&2; exit 2 ;;
esac
