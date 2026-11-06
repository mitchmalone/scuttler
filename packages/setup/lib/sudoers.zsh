# sudoers.zsh — scuttler's one root-owned path: a sudoers rule that lets the
# app's `awake` switch macOS sleep off while a hold is armed, and back on
# (DECISIONS 2026-10-01), and lets the updates panel run `mas upgrade`, which
# mas 7 requires root for (DECISIONS 2026-11-06; the app shows the system
# approval sheet — Touch ID, Apple Watch or password — before each run). Exact
# commands, for this user only, no password; nothing else gains root. The app
# runs `sudo -n`, so without this file it never asks: awake holds on power
# assertions alone and the App Store row says it needs setup.
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

# The mas binary the rule names: `SCUTTLER_MAS_BIN` (tests), else the one on
# PATH. The app runs exactly this path under `sudo -n`, so the strings must
# agree byte for byte; a moved mas makes `status` report a differing rule.
sc_sudoers_mas_bin() {
  if [[ -n "${SCUTTLER_MAS_BIN:-}" ]]; then print -r -- "$SCUTTLER_MAS_BIN"; return 0; fi
  command -v mas 2>/dev/null
}

sc_sudoers_rule() {
  local user="${USER:-$(id -un)}" mas aliases="SCUTTLER_SLEEP"
  mas="$(sc_sudoers_mas_bin)"
  cat <<RULE
# Written by \`scuttler sudoers on\`; \`scuttler sudoers off\` removes it.
# Lets scuttler's awake switch macOS sleep off while a hold is armed, and back on.
Cmnd_Alias SCUTTLER_SLEEP = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0
RULE
  if [[ -n "$mas" ]]; then
    aliases="SCUTTLER_SLEEP, SCUTTLER_UPDATES"
    cat <<RULE
# Lets the updates panel upgrade App Store apps (mas requires root); the app
# asks for Touch ID, Apple Watch or your password before each run.
Cmnd_Alias SCUTTLER_UPDATES = ${mas} upgrade, ${mas} upgrade *, ${mas} update, ${mas} update *
RULE
  else
    print -r -- "# mas was not installed when this was written; rerun \`scuttler sudoers on\` after installing it."
  fi
  print -r -- "${user} ALL=(root) NOPASSWD: ${aliases}"
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
      if [[ -n "$(sc_sudoers_mas_bin)" ]]; then
        sc_ok "$target: awake can switch macOS sleep off while it holds; the updates panel can upgrade App Store apps after the approval sheet"
      else
        sc_ok "$target: awake can switch macOS sleep off while it holds (no mas: rerun after installing it for App Store updates)"
      fi ;;
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
