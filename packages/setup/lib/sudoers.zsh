# sudoers.zsh — scuttler's one root-owned path: a sudoers rule that lets the
# app's `awake` switch macOS sleep off while a hold is armed, and back on
# (DECISIONS 2026-10-01). Exactly two commands, for this user only, no
# password; nothing else gains root. The app runs `sudo -n`, so without this
# file it never asks — it just holds on power assertions alone.
#
# Installed 0444 (root-owned, never writable but readable) so `doctor` can
# check its hash without sudo. Recorded in the manifest as mode `root`, which
# `remove` undoes with one more sudo.

sc_sudoers_path() { print -r -- "${SCUTTLER_SUDOERS_PATH:-/etc/sudoers.d/scuttler}"; }
# The file the previous name wrote (DECISIONS 2026-11-01). Root-owned, so the app
# cannot move it; its rule still grants, `on` replaces it, `off` removes both.
sc_sudoers_previous_path() { print -r -- "${SCUTTLER_SUDOERS_PREVIOUS_PATH:-/etc/sudoers.d/scuttlarr}"; }

# sudo, or the test fixture standing in for it.
_sc_sudo() { "${SCUTTLER_SUDO_BIN:-/usr/bin/sudo}" "$@"; }

sc_sudoers_rule() {
  local user="${USER:-$(id -un)}"
  cat <<RULE
# Written by \`scuttler sudoers on\`; \`scuttler sudoers off\` removes it.
# Lets scuttler's awake switch macOS sleep off while a hold is armed, and back on.
Cmnd_Alias SCUTTLER_SLEEP = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0
${user} ALL=(root) NOPASSWD: SCUTTLER_SLEEP
RULE
}

# on | off | status
# Remove the previous name's file while sudo is warm; its manifest line goes too.
_sc_sudoers_retire_previous() {
  local previous; previous="$(sc_sudoers_previous_path)"
  if [[ -e "$previous" ]]; then
    if _sc_sudo /bin/rm -f "$previous"; then
      sc_ok "$previous: pre-rename rule removed"
    else
      sc_warn "$previous: could not remove the pre-rename rule (harmless; \`sudo rm\` it)"
    fi
  fi
  sc_manifest_remove "$previous"
}

sc_sudoers() {
  emulate -L zsh
  local verb="${1:-status}" target tmp want
  target="$(sc_sudoers_path)"
  case "$verb" in
    on)
      tmp="$(mktemp "${TMPDIR:-/tmp}/scuttler-sudoers.XXXXXX")"
      sc_sudoers_rule > "$tmp"
      want="$(sc_hash "$tmp")"
      if [[ -f "$target" && "$(sc_hash "$target")" == "$want" ]]; then
        rm -f "$tmp"
        sc_manifest_add root "$target" "$want" awake
        _sc_sudoers_retire_previous
        sc_ok "$target: already in place"
        return 0
      fi
      if ! "${SCUTTLER_VISUDO_BIN:-/usr/sbin/visudo}" -cf "$tmp" >/dev/null; then
        rm -f "$tmp"
        sc_die "the rule failed visudo's check — nothing installed"
      fi
      sc_log "installing $target (sudo asks for your password once)"
      if ! _sc_sudo /usr/bin/install -m 0444 -o root -g wheel "$tmp" "$target"; then
        rm -f "$tmp"
        sc_die "install refused — nothing changed"
      fi
      rm -f "$tmp"
      sc_manifest_add root "$target" "$want" awake
      _sc_sudoers_retire_previous
      sc_ok "$target: awake can now switch macOS sleep off while it holds" ;;
    off)
      if [[ -e "$(sc_sudoers_previous_path)" ]]; then
        sc_log "removing the pre-rename rule (sudo may ask for your password)"
        _sc_sudoers_retire_previous
      fi
      if [[ ! -e "$target" ]]; then
        sc_manifest_remove "$target"
        sc_ok "$target: not installed"
        return 0
      fi
      sc_log "removing $target (sudo may ask for your password)"
      _sc_sudo /bin/rm -f "$target" || sc_die "remove refused — left in place"
      sc_manifest_remove "$target"
      sc_ok "$target: removed; awake holds on power assertions alone" ;;
    status)
      if [[ ! -f "$target" ]]; then
        if [[ -f "$(sc_sudoers_previous_path)" ]]; then
          sc_ok "on — $(sc_sudoers_previous_path), the pre-rename rule (still grants; \`scuttler sudoers on\` replaces it)"
          return 0
        fi
        sc_log "off — awake can't switch macOS sleep off (\`scuttler sudoers on\`)"
        return 1
      fi
      tmp="$(mktemp "${TMPDIR:-/tmp}/scuttler-sudoers.XXXXXX")"
      sc_sudoers_rule > "$tmp"
      want="$(sc_hash "$tmp")"; rm -f "$tmp"
      if [[ "$(sc_hash "$target" 2>/dev/null)" == "$want" ]]; then
        sc_ok "on — $target"
      else
        sc_warn "$target differs from the rule scuttler writes — \`scuttler sudoers on\` rewrites it"
        return 1
      fi ;;
    *) sc_die "sudoers: on | off | status" ;;
  esac
}
