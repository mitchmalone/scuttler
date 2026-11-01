#!/bin/zsh
# The scuttlarr → scuttler hop as the setup CLI sees it (DECISIONS 2026-11-01):
# the previous name's env, touched-block markers, sudoers file, and the shipped
# migration that re-renders the shell base and removes the state symlink.
source "${0:A:h}/harness.zsh"
cli="$SCUTTLER_BASE/bin/scuttler"
cfg="$HOME/.config"
old_state="$HOME/.local/state/scuttlarr"
new_state="$HOME/.local/state/scuttler"

# ---- env: SCUTTLARR_* still points the CLI somewhere, for one release ----
out="$(env -u SCUTTLER_STATE -u SCUTTLER_OVERLAY SCUTTLARR_STATE="$T/oldstate" SCUTTLARR_OVERLAY="$T/oldoverlay" \
  zsh -c 'source "$SCUTTLER_BASE/lib/core.zsh"; print -r -- "$SCUTTLER_STATE $SCUTTLER_OVERLAY"')"
assert_eq "$T/oldstate $T/oldoverlay" "$out" "SCUTTLARR_STATE/OVERLAY honoured as fallbacks"
out="$(env -u SCUTTLER_STATE SCUTTLARR_STATE="$T/oldstate" SCUTTLER_STATE="$T/newstate" \
  zsh -c 'source "$SCUTTLER_BASE/lib/core.zsh"; print -r -- "$SCUTTLER_STATE"')"
assert_eq "$T/newstate" "$out" "SCUTTLER_STATE wins over the fallback"

# ---- touched blocks written under the previous markers are still ours ----
mkdir -p "$cfg/git"
cat > "$cfg/git/config" <<'G'
[user]
	name = Someone

# scuttlarr: begin (scuttlarr remove strips this block)
[include]
	path = ~/.config/git/scuttlarr.gitconfig
# scuttlarr: end
G
block="$(sc_touched_block "$cfg/git/config")"
assert_match "previous-marker block is found" "$block" "scuttlarr.gitconfig"
rest="$(sc_touched_strip "$cfg/git/config")"
assert_eq $'[user]\n\tname = Someone' "$rest" "previous-marker block strips cleanly"

# ---- a pre-rename shell base: generated files importing the old state path ----
mkdir -p "$new_state/current/theme" "$cfg/ghostty" "$cfg/tmux"
ln -s "$new_state" "$old_state"
print -r -- 'source ~/.local/state/scuttlarr/current/theme/zsh.zsh' > "$HOME/.zshrc"
print -r -- 'config-file = ~/.local/state/scuttlarr/current/theme/ghostty' > "$cfg/ghostty/config"
print -r -- 'source-file -q ~/.local/state/scuttlarr/current/theme/tmux.conf' > "$cfg/tmux/tmux.conf"
print -r -- '# p10k' > "$HOME/.p10k.zsh"
print -r -- '[core]' > "$cfg/git/scuttlarr.gitconfig"
for f in "$HOME/.zshrc" "$HOME/.p10k.zsh" "$cfg/ghostty/config" "$cfg/tmux/tmux.conf" "$cfg/git/scuttlarr.gitconfig"; do
  sc_manifest_add generated "$f" "$(sc_hash "$f")" shell
done
sc_manifest_add touched "$cfg/git/config" "x" git

out="$("$cli" migrate 2>&1)"; rc=$?
assert_eq 0 "$rc" "migration exits 0"
assert_match "re-rendered" "$out" "re-rendering against"
assert_fails "zshrc no longer imports the old path" grep -q ".local/state/scuttlarr" "$HOME/.zshrc"
assert_ok "ghostty imports the new path" grep -q ".local/state/scuttler/current/theme" "$cfg/ghostty/config"
assert_fails "ghostty no longer imports the old path" grep -q ".local/state/scuttlarr" "$cfg/ghostty/config"
assert_fails "tmux no longer imports the old path" grep -q ".local/state/scuttlarr" "$cfg/tmux/tmux.conf"
assert_no_file "$cfg/git/scuttlarr.gitconfig" "old gitconfig retired"
assert_fails "old gitconfig out of the manifest" sc_manifest_get "$cfg/git/scuttlarr.gitconfig"
assert_file "$cfg/git/scuttler.gitconfig" "new gitconfig rendered"
assert_eq 1 "$(grep -c 'begin' "$cfg/git/config")" "one include block, not two"
assert_ok "include block carries today's markers" grep -qF "$SC_TOUCH_BEGIN" "$cfg/git/config"
assert_fails "no previous markers left" grep -qF "$SC_TOUCH_BEGIN_PREVIOUS" "$cfg/git/config"
assert_ok "include names the new gitconfig" grep -q "scuttler.gitconfig" "$cfg/git/config"
assert_ok "user's own git config kept" grep -q "name = Someone" "$cfg/git/config"
[[ ! -L "$old_state" && ! -e "$old_state" ]]; assert_eq 0 $? "state symlink removed"
assert_match "says so" "$out" "symlink removed"
out="$("$cli" doctor 2>&1)"
assert_match "doctor: every owned path intact afterwards" "$out" "owned paths intact"

# second run: recorded, nothing to do
out="$("$cli" migrate 2>&1)"
assert_match "already done" "$out" "0 ran, 1 already done"

# ---- the symlink stays while a generated file of ours still names the old path ----
T2="$T/second"; mkdir -p "$T2/home/.local/state/scuttler"
(
  export HOME="$T2/home" SCUTTLER_STATE="$T2/state"
  ln -s "$HOME/.local/state/scuttler" "$HOME/.local/state/scuttlarr"
  mkdir -p "$HOME/.config/x"
  print -r -- 'source ~/.local/state/scuttlarr/x' > "$HOME/.config/x/rc"
  sc_manifest_add generated "$HOME/.config/x/rc" "$(sc_hash "$HOME/.config/x/rc")" other
  out="$("$cli" migrate 2>&1)"
  [[ -L "$HOME/.local/state/scuttlarr" ]] || exit 1
  [[ "$out" == *"symlink kept"* ]] || exit 2
)
assert_eq 0 $? "symlink kept while an owned file still imports the old path"

# ---- sudoers: the previous name's root-owned file ----
export SCUTTLER_SUDOERS_PATH="$T/sudoers.d/scuttler"
export SCUTTLER_SUDOERS_PREVIOUS_PATH="$T/sudoers.d/scuttlarr"
export SCUTTLER_SUDO_BIN="$SCUTTLER_BASE/test/fixtures/bin/sudo"
export FAKE_SUDO_LOG="$T/sudo.log"
mkdir -p "$T/sudoers.d"
print -r -- "old rule" > "$SCUTTLER_SUDOERS_PREVIOUS_PATH"
sc_manifest_add root "$SCUTTLER_SUDOERS_PREVIOUS_PATH" "$(sc_hash "$SCUTTLER_SUDOERS_PREVIOUS_PATH")" awake
out="$("$cli" sudoers status 2>&1)"; rc=$?
assert_eq 0 "$rc" "status is on with only the pre-rename file"
assert_match "status names it" "$out" "pre-rename rule"
assert_ok "on installs the new file" "$cli" sudoers on >/dev/null 2>&1
assert_file "$SCUTTLER_SUDOERS_PATH" "new rule installed"
assert_no_file "$SCUTTLER_SUDOERS_PREVIOUS_PATH" "pre-rename file removed"
assert_fails "pre-rename file out of the manifest" sc_manifest_get "$SCUTTLER_SUDOERS_PREVIOUS_PATH"
assert_eq "root" "$(sc_manifest_mode "$SCUTTLER_SUDOERS_PATH")" "new file in the manifest"
assert_match "removal went through sudo" "$(cat "$FAKE_SUDO_LOG")" "/bin/rm -f $SCUTTLER_SUDOERS_PREVIOUS_PATH"

t_done
