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
# Already root? The app runs `sudoers install|remove` as root under the system
# admin dialog (DECISIONS 2026-11-07); there sudo would be a second prompt, and
# a `sudo -n` would refuse. `SCUTTLER_EUID` lets the tests walk that path.
_sc_root() { (( ${SCUTTLER_EUID:-$EUID} == 0 )); }
_sc_as_root() { if _sc_root; then "$@"; else _sc_sudo "$@"; fi; }

# The mas binary the rule names: `SCUTTLER_MAS_BIN` (tests), else the one on
# PATH. The app runs exactly this path under `sudo -n`, so the strings must
# agree byte for byte; a moved mas makes `status` report a differing rule.
sc_sudoers_mas_bin() {
  if [[ -n "${SCUTTLER_MAS_BIN:-}" ]]; then print -r -- "$SCUTTLER_MAS_BIN"; return 0; fi
  command -v mas 2>/dev/null
}

# The rule's user: `SCUTTLER_RULE_USER` (the app passes it, since under the
# admin dialog `USER` is root's), else the login user.
sc_sudoers_rule() {
  local user="${SCUTTLER_RULE_USER:-${USER:-$(id -un)}}" mas aliases="SCUTTLER_SLEEP"
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
    if _sc_as_root /bin/rm -f "$previous"; then
      sc_ok "$previous: pre-rename rule removed"
    else
      sc_warn "$previous: could not remove the pre-rename rule (harmless; \`sudo rm\` it)"
    fi
  fi
  sc_manifest_remove "$previous"
}

# The root half of `on`: write the rule, visudo-checked, 0444, root-owned
# (install(1) as root makes it so), and retire the pre-rename file. No
# manifest: that is the user's file, written by `on` as the user. Options pin
# what root cannot look up: `--mas <path>` (root's PATH has no Homebrew; the
# app passes the mas it will run, byte for byte) and `--user <name>`.
_sc_sudoers_install() {
  local target tmp want
  while (( $# )); do
    case "$1" in
      --mas) export SCUTTLER_MAS_BIN="$2"; shift 2 ;;
      --user) export SCUTTLER_RULE_USER="$2"; shift 2 ;;
      *) sc_die "sudoers install: unknown option $1" ;;
    esac
  done
  target="$(sc_sudoers_path)"
  tmp="$(mktemp "${TMPDIR:-/tmp}/scuttler-sudoers.XXXXXX")"
  sc_sudoers_rule > "$tmp"
  want="$(sc_hash "$tmp")"
  if [[ -f "$target" && "$(sc_hash "$target")" == "$want" ]]; then
    rm -f "$tmp"
    _sc_sudoers_retire_previous
    sc_ok "$target: already in place"
    return 0
  fi
  if ! "${SCUTTLER_VISUDO_BIN:-/usr/sbin/visudo}" -cf "$tmp" >/dev/null; then
    rm -f "$tmp"
    sc_die "the rule failed visudo's check — nothing installed"
  fi
  _sc_root || sc_log "installing $target (sudo asks for your password once)"
  if ! _sc_as_root /usr/bin/install -m 0444 "$tmp" "$target"; then
    rm -f "$tmp"
    sc_die "install refused — nothing changed"
  fi
  rm -f "$tmp"
  _sc_sudoers_retire_previous
  sc_ok "$target: installed"
}

# The root half of `off`: both files gone. No manifest, as above.
_sc_sudoers_remove() {
  local target; target="$(sc_sudoers_path)"
  if [[ -e "$(sc_sudoers_previous_path)" ]]; then
    _sc_root || sc_log "removing the pre-rename rule (sudo may ask for your password)"
    _sc_sudoers_retire_previous
  fi
  if [[ ! -e "$target" ]]; then
    sc_ok "$target: not installed"
    return 0
  fi
  _sc_root || sc_log "removing $target (sudo may ask for your password)"
  _sc_as_root /bin/rm -f "$target" || sc_die "remove refused — left in place"
  sc_ok "$target: removed"
}

# on | off | status, and the root halves install | remove the app runs under
# the system admin dialog before `on` | `off` as the user records the manifest.
sc_sudoers() {
  emulate -L zsh
  local verb="${1:-status}" target tmp want
  shift $(( $# > 0 ))
  target="$(sc_sudoers_path)"
  case "$verb" in
    install) _sc_sudoers_install "$@" ;;
    remove) _sc_sudoers_remove ;;
    on)
      _sc_sudoers_install "$@" || return 1
      sc_manifest_add root "$target" "$(sc_hash "$target")" awake
      if [[ -n "$(sc_sudoers_mas_bin)" ]]; then
        sc_ok "awake can switch macOS sleep off while it holds; the updates panel can upgrade App Store apps after the approval sheet"
      else
        sc_ok "awake can switch macOS sleep off while it holds (no mas: rerun after installing it for App Store updates)"
      fi ;;
    off)
      _sc_sudoers_remove || return 1
      sc_manifest_remove "$(sc_sudoers_previous_path)"
      sc_manifest_remove "$target"
      sc_ok "awake holds on power assertions alone; the App Store row says it needs admin" ;;
    status)
      if [[ ! -f "$target" ]]; then
        if [[ -f "$(sc_sudoers_previous_path)" ]]; then
          sc_ok "on — $(sc_sudoers_previous_path), the pre-rename rule (still grants; \`scuttler sudoers on\` replaces it)"
          return 0
        fi
        sc_log "off — awake can't switch macOS sleep off, App Store updates need admin (\`scuttler sudoers on\`, or ↵ on the row)"
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
    *) sc_die "sudoers: on | off | status | install [--mas <path>] [--user <name>] | remove" ;;
  esac
}
