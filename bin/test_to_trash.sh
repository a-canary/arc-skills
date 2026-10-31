#!/usr/bin/env bash
# Tests for bin/to-trash. Run: bash bin/test_to_trash.sh
# Each case gets a throwaway $HOME so the default trash root
# ($HOME/trash) and the home/vault guards are exercised for real.
set -uo pipefail
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/to-trash"
R="$(mktemp -d)"; trap 'chmod -R u+w "$R"; rm -rf "$R"' EXIT
REAL_PATH="$PATH"
pass=0; failed=0; failures=()

fail() { echo "    $*" >&2; exit 1; }
# refuses <args...>: to-trash must exit non-zero; stderr kept in $T/err.
refuses() { ! "$BIN" "$@" >/dev/null 2>"$T/err"; }
only_entry() { local e=("$1"/*); [[ ${#e[@]} -eq 1 && -e "${e[0]}" ]] || fail "expected one entry in $1, got: ${e[*]}"; printf '%s' "${e[0]}"; }

run() {
  T="$(mktemp -d "$R/t.XXXXXX")"
  export HOME="$T/home"; mkdir -p "$HOME"
  unset TRASH_ROOT; PATH="$REAL_PATH"
  ROOT="$HOME/trash"
  if ( set -e; "$1" ); then echo "ok   $1"; pass=$((pass+1))
  else echo "FAIL $1"; failed=$((failed+1)); failures+=("$1"); fi
}

# --- basics -----------------------------------------------------------------

test_trash_and_restore_roundtrip() {
  mkdir -p "$T/w/sub"; echo hello > "$T/w/sub/doomed.txt"
  "$BIN" "$T/w/sub/doomed.txt" --reason "test" >/dev/null
  [[ ! -e "$T/w/sub/doomed.txt" ]] || fail "original still present"
  d="$(only_entry "$ROOT")"
  [[ "$(cat "$d/doomed.txt")" == hello ]] || fail "content lost"
  grep -qx "reason: test" "$d/reason.md" || fail "reason not recorded"
  grep -qx "from: $T/w/sub/doomed.txt" "$d/reason.md" || fail "from not recorded"
  "$BIN" "$(basename "$d")" --restore >/dev/null
  [[ "$(cat "$T/w/sub/doomed.txt")" == hello ]] || fail "restore did not return the file"
  [[ ! -e "$d" ]] || fail "trash dir left behind after successful restore"
}

test_refuses_missing_path_and_git_internals() {
  mkdir -p "$T/repo/.git/objects"; echo g > "$T/repo/.git/objects/f"
  refuses "$T/repo/.git/objects/f" --reason t || fail "should refuse inside .git"
  refuses "$T/repo/.git" --reason t || fail "should refuse .git itself"
  refuses "$T/nope.txt" --reason t || fail "should refuse missing path"
  echo x > "$T/keep.txt"
  refuses "$T/keep.txt" || fail "should refuse a missing reason"
  refuses "$T/keep.txt" --reason " " || fail "should refuse a blank reason"
  [[ -e "$T/keep.txt" ]] || fail "refused item was moved"
}

# --- hole 2: durable, in-lane root; no /tmp fallback, no in-repo .trash ------

test_hole2_default_root_is_home_trash_for_repo_paths() {
  mkdir -p "$T/repo/sub"; git -C "$T/repo" init -q
  echo x > "$T/repo/sub/f.txt"
  "$BIN" "$T/repo/sub/f.txt" --reason t >/dev/null
  [[ ! -e "$T/repo/.trash" ]] || fail "in-repo .trash used (dies to git clean -fdx)"
  d="$(only_entry "$ROOT")"; [[ -f "$d/f.txt" ]] || fail "not in $ROOT"
}

test_hole2_default_root_is_home_trash_for_loose_paths() {
  mkdir -p "$T/loose"; echo x > "$T/loose/zcd-loose-$$.txt"
  "$BIN" "$T/loose/zcd-loose-$$.txt" --reason t >/dev/null
  ! ls -d /tmp/trash/*"zcd-loose-$$"* >/dev/null 2>&1 || fail "fell back to /tmp/trash"
  d="$(only_entry "$ROOT")"; [[ -f "$d/zcd-loose-$$.txt" ]] || fail "not in $ROOT"
}

test_hole2_trash_root_env_override() {
  export TRASH_ROOT="$T/elsewhere"
  echo x > "$T/f.txt"
  "$BIN" "$T/f.txt" --reason t >/dev/null
  d="$(only_entry "$TRASH_ROOT")"; [[ -f "$d/f.txt" ]] || fail "TRASH_ROOT ignored"
  "$BIN" "$(basename "$d")" --restore >/dev/null
  [[ -f "$T/f.txt" ]] || fail "restore did not honour TRASH_ROOT"
}

test_medium_trash_root_created_private() {
  echo x > "$T/f.txt"
  ( umask 022; "$BIN" "$T/f.txt" --reason t >/dev/null )
  [[ "$(stat -c %a "$ROOT")" == 700 ]] || fail "root mode $(stat -c %a "$ROOT"), want 700"
}

# --- hole 1: restore never clobbers, nests, or drops the only copy ----------

test_hole1_restore_refuses_when_original_recreated_as_file() {
  echo old > "$T/f.txt"
  "$BIN" "$T/f.txt" --reason t >/dev/null
  d="$(only_entry "$ROOT")"
  echo new > "$T/f.txt"
  refuses "$(basename "$d")" --restore || fail "restore over existing file succeeded"
  [[ "$(cat "$T/f.txt")" == new ]] || fail "recreated original was overwritten"
  [[ "$(cat "$d/f.txt")" == old ]] || fail "trash copy deleted"
}

test_hole1_restore_refuses_when_original_recreated_as_dir() {
  mkdir -p "$T/d"; echo old > "$T/d/inner"
  "$BIN" "$T/d" --reason t >/dev/null
  d="$(only_entry "$ROOT")"
  mkdir "$T/d"
  refuses "$(basename "$d")" --restore || fail "restore over existing dir succeeded"
  [[ ! -e "$T/d/d" ]] || fail "restore nested the item inside the recreated dir"
  [[ "$(cat "$d/d/inner")" == old ]] || fail "trash copy deleted"
}

test_hole1_restore_keeps_trash_copy_when_move_fails() {
  mkdir -p "$T/ro"; echo old > "$T/ro/f.txt"
  "$BIN" "$T/ro/f.txt" --reason t >/dev/null
  d="$(only_entry "$ROOT")"
  chmod 555 "$T/ro"
  refuses "$(basename "$d")" --restore || fail "restore into read-only dir reported success"
  chmod 755 "$T/ro"
  [[ "$(cat "$d/f.txt")" == old ]] || fail "trash copy deleted after failed move"
}

# --- hole 3: a symlink argument trashes the link, not its target ------------

test_hole3_symlink_trashes_link_not_target() {
  mkdir -p "$T/real"; echo precious > "$T/real/target.txt"
  ln -s "$T/real/target.txt" "$T/link"
  "$BIN" "$T/link" --reason t >/dev/null
  [[ "$(cat "$T/real/target.txt")" == precious ]] || fail "symlink target was trashed"
  [[ ! -e "$T/link" && ! -L "$T/link" ]] || fail "link still present"
  d="$(only_entry "$ROOT")"
  [[ -L "$d/link" ]] || fail "trashed item is not the link"
  "$BIN" "$(basename "$d")" --restore >/dev/null
  [[ -L "$T/link" && "$(readlink "$T/link")" == "$T/real/target.txt" ]] || fail "link not restored"
}

test_hole3_dangling_symlink_can_be_trashed() {
  ln -s "$T/does-not-exist" "$T/dangling"
  "$BIN" "$T/dangling" --reason t >/dev/null
  [[ ! -L "$T/dangling" ]] || fail "dangling link not trashed"
}

# --- hole 4: refuse ~/vault itself and ancestors of the trash root / $HOME ---
# TRASH_ROOT sits outside $T so mv's own "move into itself" check cannot mask a
# missing guard; a refusal must also leave no debris in the trash root.

no_debris() { [[ ! -d "$TRASH_ROOT" ]] || [[ -z "$(ls -A "$TRASH_ROOT")" ]] || fail "refusal left debris: $(ls -A "$TRASH_ROOT")"; }

test_hole4_refuses_vault_itself() {
  export TRASH_ROOT="$R/root.${T##*.}"
  mkdir -p "$HOME/vault/notes"
  refuses "$HOME/vault" --reason t || fail "trashed ~/vault itself"
  [[ -d "$HOME/vault/notes" ]] || fail "vault damaged"
  refuses "$HOME/vault/notes" --reason t || fail "trashed a path under ~/vault"
  no_debris
}

test_hole4_refuses_home_and_its_ancestors() {
  export TRASH_ROOT="$R/root.${T##*.}"
  refuses "$HOME" --reason t || fail "trashed \$HOME"
  refuses "$T" --reason t || fail "trashed an ancestor of \$HOME"
  [[ -d "$HOME" ]] || fail "\$HOME gone"
  no_debris
}

test_hole4_refuses_default_root_and_its_entries() {
  mkdir -p "$ROOT/old-entry"
  refuses "$ROOT" --reason t || fail "trashed the default root ~/trash itself"
  refuses "$ROOT/old-entry" --reason t || fail "trashed a path under the default root"
  [[ -d "$ROOT/old-entry" ]] || fail "default root entry damaged"
  [[ "$(ls -A "$ROOT")" == old-entry ]] || fail "refusal left debris: $(ls -A "$ROOT")"
}

test_hole4_refuses_ancestor_of_trash_root() {
  export TRASH_ROOT="$T/outer/inner/trash"; mkdir -p "$TRASH_ROOT"
  refuses "$T/outer" --reason t || fail "trashed an ancestor of the trash root"
  refuses "$T/outer/inner/trash" --reason t || fail "trashed the trash root itself"
  [[ -d "$TRASH_ROOT" ]] || fail "trash root gone"
  no_debris
}

# --- hole 5: newline paths — refused up front, original untouched -----------

test_hole5_newline_path_refused_or_roundtrips() {
  nl="$T/a"$'\n'"b"; echo keep > "$nl"
  if "$BIN" "$nl" --reason t >/dev/null 2>"$T/err"; then
    d="$(only_entry "$ROOT")"
    "$BIN" "$(basename "$d")" --restore >/dev/null 2>&1 || fail "newline path trashed but restore failed"
    [[ "$(cat "$nl")" == keep ]] || fail "newline path not restored"
  else
    [[ "$(cat "$nl")" == keep ]] || fail "refused but original damaged"
    grep -qi newline "$T/err" || fail "refusal does not explain why: $(cat "$T/err")"
  fi
}

# --- medium: sidecar exists before the item is moved -------------------------

test_medium_sidecar_written_before_move() {
  mkdir -p "$T/shim"
  cat > "$T/shim/mv" <<EOF
#!/usr/bin/env bash
d="\$(dirname "\${@: -1}")"
[[ -f "\$d/reason.md" ]] && echo yes > "$T/sidecar-first" || echo no > "$T/sidecar-first"
exec "$(command -v mv)" "\$@"
EOF
  chmod +x "$T/shim/mv"
  echo x > "$T/f.txt"
  PATH="$T/shim:$PATH" "$BIN" "$T/f.txt" --reason t >/dev/null
  [[ "$(cat "$T/sidecar-first" 2>/dev/null)" == yes ]] || fail "reason.md not written before mv"
}

# --- review r2: the sidecar survives a reason.md item and a partial move ------

test_item_named_reason_md_keeps_sidecar() {
  mkdir -p "$T/w"; echo mine > "$T/w/reason.md"
  "$BIN" "$T/w/reason.md" --reason t >/dev/null
  d="$(only_entry "$ROOT")"
  grep -qx "from: $T/w/reason.md" "$d/reason.md" || fail "sidecar overwritten by the item"
  "$BIN" "$d" --restore >/dev/null
  [[ "$(cat "$T/w/reason.md")" == mine ]] || fail "item not restored"
}

test_partial_move_keeps_entry_restorable() {
  mkdir -p "$T/shim"
  printf '#!/usr/bin/env bash\n"%s" "$@"; exit 1\n' "$(command -v mv)" > "$T/shim/mv"   # moves, then reports failure
  chmod +x "$T/shim/mv"
  echo x > "$T/f.txt"
  ! PATH="$T/shim:$PATH" "$BIN" "$T/f.txt" --reason t >/dev/null 2>"$T/err" || fail "partial move reported success"
  d="$(only_entry "$ROOT")"
  [[ -f "$d/reason.md" && -f "$d/f.txt" ]] || fail "entry lost its sidecar or item"
  grep -q '^status: incomplete' "$d/reason.md" || fail "partial entry not marked incomplete"
  "$BIN" "$d" --restore >/dev/null
  [[ "$(cat "$T/f.txt")" == x ]] || fail "item not restored"
}

for t in $(declare -F | awk '{print $3}' | grep '^test_'); do run "$t"; done
echo "---"
echo "to-trash: $pass passed, $failed failed"
[[ $failed -eq 0 ]] || { printf '  %s\n' "${failures[@]}"; exit 1; }
