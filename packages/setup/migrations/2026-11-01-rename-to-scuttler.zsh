# scuttlarr → scuttler (DECISIONS 2026-11-01). The app moved the state dir and
# left `~/.local/state/scuttlarr` as a symlink so the shell base's generated
# files, which import the theme from that absolute path, kept working. This
# re-renders them against the new path, retires the old gitconfig the include
# stanza pointed at, and removes the symlink once nothing we wrote still names
# the old path. Idempotent: a home that never had the shell base, or has run
# this once, falls straight through.

local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
local old_state="${XDG_STATE_HOME:-$HOME/.local/state}/scuttlarr"
local old_gitconfig="$cfg/git/scuttlarr.gitconfig"

# The shell base was applied before the rename: its files are in the manifest.
if [[ "$(sc_manifest_mode "$HOME/.zshrc" 2>/dev/null)" == generated ]]; then
  sc_log "shell base: re-rendering against $(sc_shell_theme_dir)"
  sc_shell_run apply
fi

# The old gitconfig was ours (generated); the new include stanza no longer names it.
if [[ "$(sc_manifest_mode "$old_gitconfig" 2>/dev/null)" == generated ]]; then
  rm -f "$old_gitconfig"
  sc_manifest_remove "$old_gitconfig"
  sc_ok "$(sc_tilde "$old_gitconfig"): retired"
fi

# The symlink goes when no generated file of ours still imports the old path.
if [[ -L "$old_state" ]]; then
  local line mode target still=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    mode="${${(s:	:)line}[1]}"; target="${${(s:	:)line}[2]}"
    if [[ "$mode" == generated && -f "$target" ]] && grep -qF -- ".local/state/scuttlarr" "$target"; then
      still=1
      sc_warn "$(sc_tilde "$target") still imports the old state path; symlink kept"
    fi
  done < <(sc_manifest_list)
  if (( ! still )); then
    rm -f "$old_state"
    sc_ok "$(sc_tilde "$old_state"): symlink removed"
  fi
fi
