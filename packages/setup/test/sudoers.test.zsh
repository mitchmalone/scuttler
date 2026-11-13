#!/bin/zsh
source "${0:A:h}/harness.zsh"

cli="$SCUTTLER_BASE/bin/scuttler"

export SCUTTLER_SUDOERS_PATH="$T/sudoers.d/scuttler"
# The previous name's file too: the default is the real /etc path, which may exist
# on the developer's Mac (rename.test.zsh covers what happens when it does).
export SCUTTLER_SUDOERS_PREVIOUS_PATH="$T/sudoers.d/scuttlarr"
export SCUTTLER_SUDO_BIN="$SCUTTLER_BASE/test/fixtures/bin/sudo"
export FAKE_SUDO_LOG="$T/sudo.log"
# The mas the copy is taken from, pinned so the test does not depend on this Mac,
# and where the root-owned copy goes.
mkdir -p "$T/brew/bin" "$T/sudoers.d"
print -r -- '#!/bin/sh' > "$T/brew/bin/mas"; print -r -- 'echo mas 1' >> "$T/brew/bin/mas"; chmod +x "$T/brew/bin/mas"
export SCUTTLER_MAS_BIN="$T/brew/bin/mas"
export SCUTTLER_MAS_COPY="$T/libexec/scuttler/mas"
target="$SCUTTLER_SUDOERS_PATH"
copy="$SCUTTLER_MAS_COPY"

# The rule names exactly the two pmset commands and the root-owned copy of mas
# (never the Homebrew path), for this user, no password.
rule="$(sc_sudoers_rule)"
assert_match "rule allows disablesleep 1" "$rule" "/usr/bin/pmset -a disablesleep 1"
assert_match "rule allows disablesleep 0" "$rule" "/usr/bin/pmset -a disablesleep 0"
assert_match "rule allows mas upgrade at the copy" "$rule" "$copy upgrade, $copy upgrade *"
assert_match "rule allows mas update at the copy" "$rule" "$copy update, $copy update *"
if [[ "$rule" == *"$T/brew/bin/mas"* ]]; then (( T_FAIL++ )); print -r -- "  FAIL rule must not name the source mas" >&2; else (( T_PASS++ )); fi
assert_match "rule is for this user" "$rule" "${USER:-$(id -un)} ALL=(root) NOPASSWD: SCUTTLER_SLEEP, SCUTTLER_UPDATES"
# Without mas the sleep alias stands alone and the rule says what to rerun.
no_mas="$(SCUTTLER_MAS_BIN= PATH=/usr/bin:/bin sc_sudoers_rule)"
assert_eq "${USER:-$(id -un)} ALL=(root) NOPASSWD: SCUTTLER_SLEEP" "$(print -r -- "$no_mas" | tail -1)" "no mas: sleep alone"
assert_match "no mas: says to rerun" "$no_mas" "rerun"
print -r -- "$rule" > "$T/rule"
assert_ok "visudo accepts the rule" /usr/sbin/visudo -cf "$T/rule"
# A user name is a name, not a User_List.
assert_fails "a User_List is not a user" env SCUTTLER_RULE_USER='bob ALL=(ALL) NOPASSWD: ALL' "$cli" sudoers status 2>/dev/null
assert_fails "ALL is not a user" env SCUTTLER_RULE_USER=ALL "$cli" sudoers status 2>/dev/null

assert_fails "status is off before install" "$cli" sudoers status 2>/dev/null
"$cli" sudoers on >/dev/null 2>&1
assert_file "$target" "rule installed"
assert_eq "$rule" "$(cat "$target")" "installed rule is the rule"
assert_eq "r--r--r--" "$(stat -f %Sp "$target" | cut -c2-)" "installed read-only"
assert_file "$copy" "mas copied beside the rule"
assert_eq "$(cat "$T/brew/bin/mas")" "$(cat "$copy")" "the copy is the source"
assert_eq "root" "$(sc_manifest_mode "$target")" "manifest records it as root"
assert_match "install went through sudo" "$(cat "$FAKE_SUDO_LOG")" "/usr/bin/install -m 0444 "
assert_match "copy went through sudo" "$(cat "$FAKE_SUDO_LOG")" "/usr/bin/install -m 0755 $T/brew/bin/mas $copy"
assert_ok "status is on after install" "$cli" sudoers status 2>/dev/null

: > "$FAKE_SUDO_LOG"
"$cli" sudoers on >/dev/null 2>&1
assert_eq "" "$(cat "$FAKE_SUDO_LOG")" "a second on asks nothing"

# Homebrew upgrades mas: status says the copy is stale, on refreshes it.
print -r -- 'echo mas 2' >> "$T/brew/bin/mas"
assert_fails "status notices a changed mas" "$cli" sudoers status 2>/dev/null
: > "$FAKE_SUDO_LOG"
"$cli" sudoers on >/dev/null 2>&1
assert_eq "$(cat "$T/brew/bin/mas")" "$(cat "$copy")" "on refreshes the copy"
assert_match "the refresh went through sudo" "$(cat "$FAKE_SUDO_LOG")" "/usr/bin/install -m 0755 "
assert_ok "status is on again" "$cli" sudoers status 2>/dev/null

# remove undoes it with sudo.
"$cli" remove --yes >/dev/null 2>&1
assert_no_file "$target" "remove deletes the rule"
assert_match "remove went through sudo" "$(cat "$FAKE_SUDO_LOG")" "/bin/rm -f $target"

"$cli" sudoers on >/dev/null 2>&1
"$cli" sudoers off >/dev/null 2>&1
assert_no_file "$target" "off deletes the rule"
assert_no_file "$copy" "off deletes the copy"
assert_fails "manifest forgets it" sc_manifest_mode "$target"

# The terminal's root half as root (sudo scuttler sudoers install): pins for what
# root cannot look up, no sudo, no manifest; then `record` as the user.
: > "$FAKE_SUDO_LOG"
SCUTTLER_EUID=0 "$cli" sudoers install --mas "$T/brew/bin/mas" --user bob >/dev/null 2>&1
assert_file "$target" "install as root writes the rule"
assert_match "install names the copy" "$(cat "$target")" "$copy upgrade"
assert_match "install pins the user" "$(cat "$target")" "bob ALL=(root) NOPASSWD:"
assert_eq "" "$(cat "$FAKE_SUDO_LOG")" "install as root never calls sudo"
assert_fails "install writes no manifest" sc_manifest_mode "$target"
"$cli" sudoers record >/dev/null 2>&1
assert_eq "root" "$(sc_manifest_mode "$target")" "record writes the manifest line"
assert_ok "status with pins is on" "$cli" sudoers status --mas "$T/brew/bin/mas" --user bob 2>/dev/null
assert_fails "status without the pins differs" "$cli" sudoers status 2>/dev/null
SCUTTLER_EUID=0 "$cli" sudoers remove >/dev/null 2>&1
assert_no_file "$target" "remove as root deletes the rule"
assert_eq "" "$(cat "$FAKE_SUDO_LOG")" "remove as root never calls sudo"
assert_eq "root" "$(sc_manifest_mode "$target")" "remove leaves the manifest to forget"
"$cli" sudoers forget >/dev/null 2>&1
assert_fails "forget drops the manifest line" sc_manifest_mode "$target"
assert_fails "record with no rule fails" "$cli" sudoers record 2>/dev/null
assert_fails "a bare --mas is an error, not a loop" "$cli" sudoers status --mas 2>/dev/null
assert_fails "a relative --mas is refused" env SCUTTLER_EUID=0 "$cli" sudoers install --mas brew/bin/mas --user bob 2>/dev/null
assert_fails "unknown verb fails" "$cli" sudoers frobnicate 2>/dev/null

t_done
