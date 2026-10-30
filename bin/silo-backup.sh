#!/bin/bash
# Nightly per-silo off-box backup (operator ruling repos-0e3.15, 2026-10-30).
# Each silo keeps its snapshots in its own project dir, untracked by git. This uploads the newest
# one, age-encrypted, to R2 arc-backup/silos/<silo>/ and prunes R2 copies older than KEEP_DAYS.
# No key material in git: the CF token and the age private key live in pass; config holds only
# the public recipient. Restore: aws s3 cp s3://arc-backup/<key> - | age -d -i <private key> > file
# Status per silo → ~/.cache/silo-backup/status.json (health-monitor alerts when a silo is >26h stale).
set -uo pipefail
CONF="${SILO_CONF:-$(dirname "$0")/../config/silos.conf}"
STATUS="$HOME/.cache/silo-backup/status.json"
KEEP_DAYS="${KEEP_DAYS:-56}"
mkdir -p "$(dirname "$STATUS")"
[ -f "$STATUS" ] || echo '{}' > "$STATUS"

recipient=$(sed -n 's/^recipient=//p' "$CONF")
uid=$(pass show cloudflare/userid)
# ponytail: pass entry cloudflare/r2-secret-key holds a CF API token, not an S3 secret; R2 derives
# S3 creds from it (id + sha256(token)). Rename the entry if an S3-native key pair is ever minted.
tok=$(pass show cloudflare/r2-secret-key)
AWS_ACCESS_KEY_ID=$(curl -s -m 15 -H "Authorization: Bearer $tok" https://api.cloudflare.com/client/v4/user/tokens/verify | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['id'])") || { echo "cf token verify failed"; exit 1; }
AWS_SECRET_ACCESS_KEY=$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1)
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
s3() { aws --endpoint-url "https://$uid.r2.cloudflarestorage.com" "$@"; }

note() { # silo ok key msg
  python3 - "$STATUS" "$@" <<'PY'
import json, sys, datetime
p, silo, ok, key, msg = sys.argv[1:6]
d = json.load(open(p)); d[silo] = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "ok": ok == "1", "key": key, "msg": msg}
json.dump(d, open(p, "w"), indent=1)
PY
  echo "$(date -u +%FT%TZ) $1 ok=$2 $3 $4"
}

rc=0
while IFS='|' read -r silo produce dir glob; do
  [[ -z "$silo" || "$silo" == \#* || "$silo" == recipient=* ]] && continue
  dir=${dir/#\~/$HOME}
  if [[ "$produce" != "-" ]] && ! bash -c "$produce"; then note "$silo" 0 "" "produce failed"; rc=1; continue; fi
  f=$(ls -t "$dir"/$glob 2>/dev/null | head -1)
  [[ -n "$f" ]] || { note "$silo" 0 "" "no snapshot in $dir"; rc=1; continue; }
  key="silos/$silo/$(basename "$f").age"
  if ! s3 s3api head-object --bucket arc-backup --key "$key" >/dev/null 2>&1; then
    age -r "$recipient" "$f" | s3 s3 cp --only-show-errors - "s3://arc-backup/$key" \
      && s3 s3api head-object --bucket arc-backup --key "$key" >/dev/null 2>&1 \
      || { note "$silo" 0 "$key" "upload failed"; rc=1; continue; }
  fi
  cutoff=$(date -u -d "-$KEEP_DAYS days" +%FT%T)
  s3 s3api list-objects-v2 --bucket arc-backup --prefix "silos/$silo/" --query "Contents[?LastModified<'$cutoff'].Key" --output text 2>/dev/null \
    | tr '\t' '\n' | grep -v -e '^None$' -e '^$' | while read -r old; do s3 s3 rm --only-show-errors "s3://arc-backup/$old"; done
  note "$silo" 1 "$key" "$(du -h "$f" | cut -f1)"
done < "$CONF"
exit $rc
