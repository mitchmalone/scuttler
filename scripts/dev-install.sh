#!/usr/bin/env bash
# Install the working-tree build over /Applications/scuttler.app and relaunch,
# without Finder or the app grabbing the screen (Mitch, 2026-09-10).
#
#   scripts/dev-install.sh          swap in the last `tauri build` and relaunch
#   scripts/dev-install.sh --build  build first
#   scripts/dev-install.sh --quit   only stop the running app (release.sh's smoke
#                                   tests want the hotkey and the bar free)
#
# Not a release: that is scripts/release.sh (signed, notarised, via the tap).
# Brew cannot do this step — the cask installs the released version, not
# target/release — so this is the one sanctioned way to run a local build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILT="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/scuttler.app"
DEST="/Applications/scuttler.app"

JOB="gui/$(id -u)/scuttler"
PLIST="$HOME/Library/LaunchAgents/scuttler.plist"
# The previous name's launchd label and process (DECISIONS 2026-11-01): a 0.8.0
# install is still running as `scuttlarr` when this build first lands.
PREV_JOB="gui/$(id -u)/scuttlarr"

# Stop the running app. The login item relaunches a crashed or killed app
# (KeepAlive, DECISIONS 2026-10-01), so a launchd-run instance is stopped
# through launchd — a pkill would have it relaunch the old binary mid-copy.
# Then quit politely (SIGTERM lets the tray icon and panel go away cleanly)
# and make sure. `open` on a running instance would only re-activate it
# (LEARNINGS).
quit_app() {
  launchctl bootout "$JOB" 2>/dev/null || true
  launchctl bootout "$PREV_JOB" 2>/dev/null || true
  for proc in scuttler scuttlarr launcharr; do
    if pgrep -x "$proc" >/dev/null; then
      pkill -TERM -x "$proc" || true
      for _ in $(seq 1 20); do pgrep -x "$proc" >/dev/null || break; sleep 0.1; done
      pkill -KILL -x "$proc" 2>/dev/null || true
    fi
  done
}

if [[ "${1:-}" == "--quit" ]]; then
  quit_app
  exit 0
fi

if [[ "${1:-}" == "--build" ]]; then
  # The .app only: the dmg step drives Finder (a window pops; without the
  # Automation grant it hangs 120 s, then fails), and only release.sh wants a
  # dmg — brew installs the zip (JOURNAL 2026-08-19, 2026-10-20).
  (cd "$ROOT" && pnpm --filter @scuttler/desktop tauri build --bundles app)
fi
[[ -d "$BUILT" ]] || { echo "no build at $BUILT — run with --build" >&2; exit 1; }

quit_app

# The pre-rename bundles (DECISIONS 2026-09-11, 2026-11-01): two launchers would
# fight over the hotkey. Moved to the Trash, not deleted — the tap reinstalls
# them if wanted.
for old in launcharr scuttlarr; do
  if [[ -d "/Applications/$old.app" ]]; then
    mv "/Applications/$old.app" "$HOME/.Trash/$old.app.$(date +%s)"
    echo "moved the old /Applications/$old.app to the Trash"
  fi
done

# ditto replaces the bundle's contents in place: no delete-then-copy that
# Finder notices, resource forks and permissions kept.
ditto "$BUILT" "$DEST"

# Relaunch through launchd when the login item is on (RunAtLoad starts it and
# launchd supervises it from here); otherwise -g: launch without bringing it to
# the foreground — a fresh bundle's first launch otherwise steals focus.
if [[ -f "$PLIST" ]] && launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  :
else
  open -g "$DEST"
fi
echo "installed $(plutil -extract CFBundleShortVersionString raw "$DEST/Contents/Info.plist") → $DEST (relaunched in the background)"
