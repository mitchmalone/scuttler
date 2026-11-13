# sudoers.zsh — scuttler's one root-owned path: a sudoers rule that lets the
# app's `awake` switch macOS sleep off while a hold is armed, and back on
# (DECISIONS 2026-10-01), and lets the updates panel run `mas upgrade`, which
# mas 7 requires root for (DECISIONS 2026-11-06; the app shows the system
# approval sheet — Touch ID, Apple Watch or password — before each run). Exact
# commands, for this user only, no password. The mas the rule names is
# scuttler's root-owned copy under /usr/local/libexec/scuttler, never
# Homebrew's: sudo checks the path, not its owner, and a user-writable path in
# a NOPASSWD rule is root for anything running as the user (DECISIONS
# 2026-11-08, the readiness review's B1). The app runs `sudo -n`, so without
# this file it never asks: awake holds on power assertions alone and the App
# Store row says it needs admin once.
#
# Installed 0444 (root-owned, never writable but readable) so `doctor` can
# check its hash without sudo. Recorded in the manifest as mode `root`, which
# `remove` undoes with one more sudo.
#
# From the app the root half is not this file: `sudoers.rs` builds the same
# rule text and runs three absolute commands under the admin dialog with an
# empty environment, then calls `record` | `forget` here as the user. From a
# terminal, `on` | `off` do both halves with one sudo.

sc_sudoers_path() { print -r -- "${SCUTTLER_SUDOERS_PATH:-/etc/sudoers.d/scuttler}"; }
# The file the previous name wrote (DECISIONS 2026-11-01). Root-owned, so the app
# cannot move it; its rule still grants, `on` replaces it, `off` removes both.
sc_sudoers_previous_path() { print -r -- "${SCUTTLER_SUDOERS_PREVIOUS_PATH:-/etc/sudoers.d/scuttlarr}"; }
# The root-owned copy of mas the rule names (and the app runs under `sudo -n`).
sc_sudoers_mas_copy() { print -r -- "${SCUTTLER_MAS_COPY:-/usr/local/libexec/scuttler/mas}"; }

# sudo, or the test fixture standing in for it.
_sc_sudo() { "${SCUTTLER_SUDO_BIN:-/usr/bin/sudo}" "$@"; }
# Already root? `SCUTTLER_EUID` lets the tests walk that path.
_sc_root() { (( ${SCUTTLER_EUID:-$EUID} == 0 )); }
_sc_as_root() { if _sc_root; then "$@"; else _sc_sudo "$@"; fi; }

# The mas the copy is taken from: `SCUTTLER_MAS_BIN` (the app passes the one it
# found; tests pin it), else the one on PATH. Empty means no mas: the rule then
# names sleep alone.
sc_sudoers_mas_bin() {
  if [[ -n "${SCUTTLER_MAS_BIN:-}" ]]; then print -r -- "$SCUTTLER_MAS_BIN"; return 0; fi
  command -v mas 2>/dev/null
}

# A sudoers User_List is a grammar; the name must not be one.
_sc_sudoers_valid_user() { [[ "$1" =~ '^[A-Za-z0-9_][A-Za-z0-9_.-]*$' ]]; }

# The rule's user: `SCUTTLER_RULE_USER` (the app passes it), else the login user.
# The text is byte-identical to `sudoers.rs::rule_text` — a Rust test checks.
sc_sudoers_rule() {
  local user="${SCUTTLER_RULE_USER:-${USER:-$(id -un)}}" copy aliases="SCUTTLER_SLEEP"
  _sc_sudoers_valid_user "$user" || sc_die "sudoers: not a user name: $user"
  copy="$(sc_sudoers_mas_copy)"
  cat <<RULE
# Written by \`scuttler sudoers on\`; \`scuttler sudoers off\` removes it.
# Lets scuttler's awake switch macOS sleep off while a hold is armed, and back on.
Cmnd_Alias SCUTTLER_SLEEP = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0
RULE
  if [[ -n "$(sc_sudoers_mas_bin)" ]]; then
    aliases="SCUTTLER_SLEEP, SCUTTLER_UPDATES"
    cat <<RULE
# Lets the updates panel upgrade App Store apps (mas requires root); the app
# asks for Touch ID, Apple Watch or your password before each run. The path is
# scuttler's root-owned copy of mas, not Homebrew's: a user-writable path in a
# NOPASSWD rule would be root for anything running as you.
Cmnd_Alias SCUTTLER_UPDATES = ${copy} upgrade, ${copy} upgrade *, ${copy} update, ${copy} update *
RULE
  else
    print -r -- "# mas was not installed when this was written; rerun \`scuttler sudoers on\` after installing it."
  fi
  print -r -- "${user} ALL=(root) NOPASSWD: ${aliases}"
}

# --mas <path> --user <name>, for install | on | status | record. Each needs its
# value; a bare flag is an error, not a loop.
_sc_sudoers_opts() {
  while (( $# )); do
    case "$1" in
      --mas|--user)
        (( $# >= 2 )) || sc_die "sudoers: $1 needs a value"
        [[ "$1" == --mas ]] && export SCUTTLER_MAS_BIN="$2" || export SCUTTLER_RULE_USER="$2"
        shift 2 ;;
      *) sc_die "sudoers: unknown option $1" ;;
    esac
  done
}

# Remove the previous name's file while sudo is warm; its manifest line goes too
# (as the user; `install` as root never touches the manifest).
_sc_sudoers_retire_previous() {
  local previous; previous="$(sc_sudoers_previous_path)"
  if [[ -e "$previous" ]]; then
    if _sc_as_root /bin/rm -f "$previous"; then
      sc_ok "$previous: pre-rename rule removed"
    else
      sc_warn "$previous: could not remove the pre-rename rule (harmless; \`sudo rm\` it)"
    fi
  fi
  _sc_root || sc_manifest_remove "$previous"
}

# Put the root-owned copy of mas in place (root's install makes it root:wheel).
# A copy already equal to the source is left alone.
_sc_sudoers_copy_mas() {
  local src="$1" copy; copy="$(sc_sudoers_mas_copy)"
  [[ "$src" == /* && -f "$src" ]] || sc_die "sudoers: --mas must be an absolute path to a file: $src"
  if [[ -f "$copy" && "$(sc_hash "$copy")" == "$(sc_hash "$src")" ]]; then return 0; fi
  _sc_as_root /usr/bin/install -d -m 0755 "${copy:h}" || sc_die "could not create ${copy:h}"
  _sc_as_root /usr/bin/install -m 0755 "$src" "$copy" || sc_die "could not copy mas to $copy"
  sc_ok "$copy: root-owned copy of $src"
}

# The root half of `on`: the copy of mas, then the rule, visudo-checked, 0444,
# root-owned (install(1) as root makes it so), and the pre-rename file retired.
# No manifest: that is the user's file, written by `on` | `record` as the user.
_sc_sudoers_install() {
  local target tmp want src
  _sc_sudoers_opts "$@"
  target="$(sc_sudoers_path)"
  src="$(sc_sudoers_mas_bin)"
  [[ -n "$src" ]] && _sc_sudoers_copy_mas "$src"
  tmp="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/scuttler-sudoers.XXXXXX")"
  sc_sudoers_rule > "$tmp"
  want="$(sc_hash "$tmp")"
  if [[ -f "$target" && "$(sc_hash "$target")" == "$want" ]]; then
    /bin/rm -f "$tmp"
    _sc_sudoers_retire_previous
    sc_ok "$target: already in place"
    return 0
  fi
  if ! "${SCUTTLER_VISUDO_BIN:-/usr/sbin/visudo}" -cf "$tmp" >/dev/null; then
    /bin/rm -f "$tmp"
    sc_die "the rule failed visudo's check — nothing installed"
  fi
  _sc_root || sc_log "installing $target (sudo asks for your password once)"
  if ! _sc_as_root /usr/bin/install -m 0444 "$tmp" "$target"; then
    /bin/rm -f "$tmp"
    sc_die "install refused — nothing changed"
  fi
  /bin/rm -f "$tmp"
  _sc_sudoers_retire_previous
  sc_ok "$target: installed"
}

# The root half of `off`: both rule files and the copy gone. No manifest, as above.
_sc_sudoers_remove() {
  local target copy; target="$(sc_sudoers_path)"; copy="$(sc_sudoers_mas_copy)"
  if [[ -e "$(sc_sudoers_previous_path)" ]]; then
    _sc_root || sc_log "removing the pre-rename rule (sudo may ask for your password)"
    _sc_sudoers_retire_previous
  fi
  if [[ -e "$copy" ]]; then
    _sc_as_root /bin/rm -f "$copy" && _sc_as_root /bin/rmdir "${copy:h}" 2>/dev/null
    sc_ok "$copy: removed"
  fi
  if [[ ! -e "$target" ]]; then
    sc_ok "$target: not installed"
    return 0
  fi
  _sc_root || sc_log "removing $target (sudo may ask for your password)"
  _sc_as_root /bin/rm -f "$target" || sc_die "remove refused — left in place"
  sc_ok "$target: removed"
}

# The user half of `on`: the manifest line for a rule already in place.
_sc_sudoers_record() {
  local target; target="$(sc_sudoers_path)"
  [[ -f "$target" ]] || sc_die "$target: not installed — nothing to record"
  sc_manifest_add root "$target" "$(sc_hash "$target")" awake
}

# The user half of `off`.
_sc_sudoers_forget() {
  sc_manifest_remove "$(sc_sudoers_previous_path)"
  sc_manifest_remove "$(sc_sudoers_path)"
}

# Is the rule in place and the copy current? 0 when on, 1 otherwise, with a line
# saying what to do.
_sc_sudoers_status() {
  local target tmp want src copy
  _sc_sudoers_opts "$@"
  target="$(sc_sudoers_path)"
  if [[ ! -f "$target" ]]; then
    if [[ -f "$(sc_sudoers_previous_path)" ]]; then
      sc_warn "$(sc_sudoers_previous_path), the pre-rename rule, is in place — \`scuttler sudoers on\` (or Settings → Machine) replaces it"
      return 1
    fi
    sc_log "off — awake can't switch macOS sleep off, App Store updates need admin (\`scuttler sudoers on\`, or ↵ on the row)"
    return 1
  fi
  tmp="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/scuttler-sudoers.XXXXXX")"
  sc_sudoers_rule > "$tmp"
  want="$(sc_hash "$tmp")"; /bin/rm -f "$tmp"
  if [[ "$(sc_hash "$target" 2>/dev/null)" != "$want" ]]; then
    sc_warn "$target differs from the rule scuttler writes — \`scuttler sudoers on\` rewrites it"
    return 1
  fi
  src="$(sc_sudoers_mas_bin)"; copy="$(sc_sudoers_mas_copy)"
  if [[ -n "$src" ]]; then
    if [[ ! -f "$copy" ]]; then
      sc_warn "$copy is missing — \`scuttler sudoers on\` copies mas again"
      return 1
    fi
    if [[ "$(sc_hash "$copy")" != "$(sc_hash "$src")" ]]; then
      sc_warn "mas changed since $copy was made — \`scuttler sudoers on\` (or Settings → Machine) refreshes it"
      return 1
    fi
  fi
  sc_ok "on — $target"
}

# on | off | status [--mas <path>] [--user <name>], the root halves install |
# remove, and the user halves record | forget the app calls after its own root
# step under the admin dialog.
sc_sudoers() {
  emulate -L zsh
  local verb="${1:-status}" target
  shift $(( $# > 0 ))
  target="$(sc_sudoers_path)"
  case "$verb" in
    install) _sc_sudoers_install "$@" ;;
    remove) _sc_sudoers_remove ;;
    record) _sc_sudoers_record ;;
    forget) _sc_sudoers_forget ;;
    on)
      _sc_sudoers_install "$@" || return 1
      _sc_sudoers_record
      if [[ -n "$(sc_sudoers_mas_bin)" ]]; then
        sc_ok "awake can switch macOS sleep off while it holds; the updates panel can upgrade App Store apps after the approval sheet"
      else
        sc_ok "awake can switch macOS sleep off while it holds (no mas: rerun after installing it for App Store updates)"
      fi ;;
    off)
      _sc_sudoers_remove || return 1
      _sc_sudoers_forget
      sc_ok "awake holds on power assertions alone; the App Store row says it needs admin" ;;
    status) _sc_sudoers_status "$@" ;;
    *) sc_die "sudoers: on | off | status | install | remove | record | forget  [--mas <path>] [--user <name>]" ;;
  esac
}
