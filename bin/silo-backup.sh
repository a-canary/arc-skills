#!/bin/bash
# Nightly per-silo off-box backup (operator ruling repos-0e3.15, 2026-10-30).
# Each silo keeps its snapshots in its own project dir, untracked by git. This uploads the newest
# one, age-encrypted, to R2 arc-backup/silos/<silo>/ and prunes R2 copies older than KEEP_DAYS.
# No key material in git: the CF token and the age private key live in pass; config holds only
# the public recipient. Restore: derive kid/ksec as below, then
#   s3 s3 cp s3://arc-backup/<key> - | age -d -i <(pass show cloudflare/r2-age-private-key | sed -n 1p | sed 's/^[^:]*: *//') > file
# Status per silo → ~/.cache/silo-backup/status.json (health-monitor alerts when a silo is >26h stale).
set -uo pipefail
# Cron (nightly, after deploy):
#   0 2 * * * PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin bash $HOME/repos/arc-skills/bin/silo-backup.sh >> $HOME/.cache/silo-backup/cron.log 2>&1
CONF="${SILO_CONF:-$(dirname "$0")/../config/silos.conf}"
STATUS="$HOME/.cache/silo-backup/status.json"
KEEP_DAYS="${KEEP_DAYS:-56}"
mkdir -p "$(dirname "$STATUS")"
[ -f "$CONF" ] || { echo "no config $CONF"; exit 1; }
[ -f "$STATUS" ] || echo '{}' > "$STATUS"
exec 9>"$STATUS.lock"; flock -n 9 || { echo "another silo-backup run holds the lock"; exit 1; }

note() { # silo ok key msg — atomic replace so health-monitor never reads a half-written file
  python3 - "$STATUS" "$@" <<'PY'
import json, sys, datetime, os
p, silo, ok, key, msg = sys.argv[1:6]
d = json.load(open(p)); d[silo] = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "ok": ok == "1", "key": key, "msg": msg}
json.dump(d, open(p + ".tmp", "w"), indent=1); os.replace(p + ".tmp", p)
PY
  echo "$(date -u +%FT%TZ) $1 ok=$2 $3 $4"
}
silos() { grep -v -e '^#' -e '^recipient=' -e '^$' "$CONF" | cut -d'|' -f1; }
abort() { for s in $(silos); do note "$s" 0 "" "$1"; done; exit 1; } # surface the cause, not just "stale"

recipient=$(sed -n 's/^recipient=//p' "$CONF")
[ -n "$recipient" ] || abort "no recipient in config"
uid=$(pass show cloudflare/userid) || abort "pass cloudflare/userid unreadable"
# ponytail: pass entry cloudflare/r2-secret-key holds a CF API token, not an S3 secret; R2 derives
# S3 creds from it (id + sha256(token)). Rename the entry if an S3-native key pair is ever minted.
tok=$(pass show cloudflare/r2-secret-key) || abort "pass cloudflare/r2-secret-key unreadable"
# Token goes in via stdin (-H @-), never argv; creds stay unexported so produce commands never inherit them.
kid=""
for try in 1 2 3; do # CF API flaps (empty reply) — retry before failing the whole run
  kid=$(printf 'Authorization: Bearer %s\n' "$tok" | curl -s -m 15 -H @- https://api.cloudflare.com/client/v4/user/tokens/verify | python3 -c "import json,sys
try: print(json.load(sys.stdin)['result']['id'])
except Exception: sys.exit(1)") && break
  (( try < 3 )) && sleep 30
done
[ -n "$kid" ] || abort "cf token verify failed"
ksec=$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1); unset tok
s3() { AWS_ACCESS_KEY_ID=$kid AWS_SECRET_ACCESS_KEY=$ksec AWS_DEFAULT_REGION=auto aws --endpoint-url "https://$uid.r2.cloudflarestorage.com" "$@"; }

rc=0
while IFS='|' read -r -u3 silo produce dir glob; do # conf on fd 3: nothing in the loop can swallow it
  [[ -z "$silo" || "$silo" == \#* || "$silo" == recipient=* ]] && continue
  dir=${dir/#\~/$HOME}
  if [[ "$produce" != "-" ]] && ! bash -c "$produce" </dev/null; then note "$silo" 0 "" "produce failed"; rc=1; continue; fi
  f=$(ls -t "$dir"/$glob 2>/dev/null | head -1)
  [[ -n "$f" ]] || { note "$silo" 0 "" "no snapshot in $dir"; rc=1; continue; }
  # Freshness is the snapshot's, not the run's: a produce step that silently stopped writing must not read ok.
  (( $(date +%s) - $(stat -c %Y "$f") < 26 * 3600 )) || { note "$silo" 0 "" "newest snapshot $(basename "$f") >26h old"; rc=1; continue; }
  [[ "$f" != *.gz ]] || gzip -t "$f" || { note "$silo" 0 "" "corrupt snapshot $(basename "$f")"; rc=1; continue; }
  key="silos/$silo/$(basename "$f").age"
  if ! s3 s3api head-object --bucket arc-backup --key "$key" >/dev/null 2>&1; then
    ok=0
    for try in 1 2 3; do # R2 endpoint flaps; a partial object from a failed pipe is removed before retrying
      age -r "$recipient" "$f" | s3 s3 cp --only-show-errors - "s3://arc-backup/$key" \
        && s3 s3api head-object --bucket arc-backup --key "$key" >/dev/null 2>&1 && { ok=1; break; }
      s3 s3 rm --only-show-errors "s3://arc-backup/$key" >/dev/null 2>&1; (( try < 3 )) && sleep $((try * 30))
    done
    [[ $ok == 1 ]] || { note "$silo" 0 "$key" "upload failed"; rc=1; continue; }
  fi
  # Never prune the key just verified: an unchanged snapshot (produce "-") may be its only copy.
  cutoff=$(date -u -d "-$KEEP_DAYS days" +%FT%T)
  s3 s3api list-objects-v2 --bucket arc-backup --prefix "silos/$silo/" --query "Contents[?LastModified<'$cutoff'].Key" --output text 2>/dev/null \
    | tr '\t' '\n' | grep -v -x -F -e 'None' -e '' -e "$key" | while read -r old; do s3 s3 rm --only-show-errors "s3://arc-backup/$old"; done
  note "$silo" 1 "$key" "$(du -h "$f" | cut -f1)"
done 3< "$CONF"
# Retired silos drop out of status so the health check doesn't alert on them forever.
mapfile -t names < <(silos)
python3 -c 'import json,os,sys; p=sys.argv[1]; keep=set(sys.argv[2:]); d=json.load(open(p)); json.dump({k:v for k,v in d.items() if k in keep},open(p+".tmp","w"),indent=1); os.replace(p+".tmp",p)' "$STATUS" "${names[@]}"
exit $rc
