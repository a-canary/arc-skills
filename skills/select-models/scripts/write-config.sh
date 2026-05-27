#!/usr/bin/env bash
# Write ~/.config/arc-skills.json atomically.
# Usage: write-config.sh <fast-engine> <fast-cmd> <smart-engine> <smart-cmd>
#   engine = claude | pi
#   cmd    = full CLI template containing {prompt} exactly once
# Validates both templates have {prompt} once, then writes via temp+rename so a
# crash mid-write never leaves a half-written config that downstream readers
# (pipeliner, arc-agents spawn) would choke on.

set -euo pipefail

fast_engine="${1:?fast engine}"; fast_cmd="${2:?fast cmd}"
smart_engine="${3:?smart engine}"; smart_cmd="${4:?smart cmd}"

for c in "$fast_cmd" "$smart_cmd"; do
  n="$(grep -o '{prompt}' <<<"$c" | wc -l)"
  [ "$n" = 1 ] || { echo "write-config: template must contain {prompt} exactly once: $c" >&2; exit 2; }
done

dir="$HOME/.config"
out="$dir/arc-skills.json"
mkdir -p "$dir"

tmp="$(mktemp "$dir/.arc-skills.json.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# jq builds the JSON so command strings with quotes/spaces are escaped correctly.
jq -n \
  --arg fe "$fast_engine" --arg fc "$fast_cmd" \
  --arg se "$smart_engine" --arg sc "$smart_cmd" \
  '{
     version: 1,
     models: {
       fast:  { engine: $fe, command: $fc },
       smart: { engine: $se, command: $sc }
     }
   }' > "$tmp"

mv -f "$tmp" "$out"
trap - EXIT
echo "wrote $out" >&2
cat "$out"
