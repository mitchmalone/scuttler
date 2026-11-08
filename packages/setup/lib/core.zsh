# core.zsh — paths, logging, small shared helpers. Sourced first by bin/scuttler
# and by every test. Everything else in lib/ assumes this is loaded.
#
# Every location is overridable through the environment so tests (and a curious
# user) can point the CLI at a scratch tree: nothing here hard-codes $HOME.

: "${SCUTTLER_BASE:=${${(%):-%x}:A:h:h}}"
# SCUTTLARR_* is the previous name's spelling (DECISIONS 2026-11-01): a user's own
# script or shell that still exports it is honoured for one release.
: "${SCUTTLER_STATE:=${SCUTTLARR_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/scuttler}}"
: "${SCUTTLER_OVERLAY:=${SCUTTLARR_OVERLAY:-${XDG_CONFIG_HOME:-$HOME/.config}/scuttler}}"
# The `defaults` binary — tests substitute a fake that keeps a flat store.
: "${SCUTTLER_DEFAULTS_BIN:=/usr/bin/defaults}"
: "${SCUTTLER_NO_NETWORK:=${SCUTTLARR_NO_NETWORK-}}"
export SCUTTLER_BASE SCUTTLER_STATE SCUTTLER_OVERLAY SCUTTLER_DEFAULTS_BIN
[[ -n "$SCUTTLER_NO_NETWORK" ]] && export SCUTTLER_NO_NETWORK || unset SCUTTLER_NO_NETWORK

SCUTTLER_VERSION="0.0.0-dev"

# ---- logging -----------------------------------------------------------------

# Colour only when stderr is a terminal and NO_COLOR is unset.
if [[ -t 2 && -z "${NO_COLOR-}" ]]; then
  typeset -g _sc_c_dim=$'\e[2m' _sc_c_ok=$'\e[32m' _sc_c_warn=$'\e[33m' \
    _sc_c_err=$'\e[31m' _sc_c_acc=$'\e[35m' _sc_c_off=$'\e[0m'
else
  typeset -g _sc_c_dim='' _sc_c_ok='' _sc_c_warn='' _sc_c_err='' _sc_c_acc='' _sc_c_off=''
fi

sc_log()  { print -r -- "${_sc_c_dim}·${_sc_c_off} $*" >&2; }
sc_ok()   { print -r -- "${_sc_c_ok}✓${_sc_c_off} $*" >&2; }
sc_warn() { print -r -- "${_sc_c_warn}!${_sc_c_off} $*" >&2; }
sc_err()  { print -r -- "${_sc_c_err}✗${_sc_c_off} $*" >&2; }
sc_head() { print -r -- "${_sc_c_acc}${(U)1}${_sc_c_off}" >&2; }
sc_die()  { sc_err "$@"; exit 1; }

# Ask once, y/N. zsh's `read -q` reads the terminal itself, not stdin, so a
# caller with stdin redirected (a script, a test, `</dev/null`) would still be
# asked — only ask when stdin is a terminal; anything else is a no.
sc_confirm() {
  [[ -t 0 ]] || return 1
  local reply
  read -q "reply?$1 [y/N] "
}

# ---- helpers -----------------------------------------------------------------

# Ensure the state directory exists (first write creates it).
sc_state_init() {
  [[ -d "$SCUTTLER_STATE" ]] || mkdir -p "$SCUTTLER_STATE"
}

# `~`-shorten a path for display.
sc_tilde() {
  local p="$1"
  [[ "$p" == "$HOME"/* ]] && p="~${p#$HOME}"
  print -r -- "$p"
}

# sha256 of a file, hex only. shasum ships with macOS and Linux alike.
sc_hash() {
  /usr/bin/shasum -a 256 -- "$1" | /usr/bin/cut -d' ' -f1
}

# Write stdin to a file atomically (same directory, then rename).
sc_write_atomic() {
  local target="$1" tmp
  tmp="$(mktemp "${target:h}/.sc.XXXXXX")" || return 1
  cat > "$tmp" && mv -f "$tmp" "$target"
}

# Point a symlink at a target atomically (link beside it, then rename). Refuses
# a directory: rename would drop the link inside it instead.
sc_symlink_atomic() {
  local source="$1" target="$2" tmp
  if [[ -d "$target" && ! -L "$target" ]]; then
    sc_err "$(sc_tilde "$target"): is a directory, not linking over it"; return 1
  fi
  tmp="${target:h}/.sc.link.$$"
  ln -s "$source" "$tmp" && mv -f "$tmp" "$target"
}
