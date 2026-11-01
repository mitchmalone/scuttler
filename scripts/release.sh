#!/usr/bin/env bash
# The local half of releasing scuttler. Deterministic: every step either passes or
# the script dies telling you exactly what's missing. If a release step isn't in here
# or in .github/workflows/release.yml, it isn't part of the release — add it first.
# See docs/RELEASING.md.
#
# Split (jig standard): signing, notarization, and the smoke tests stay local —
# the Developer ID identity and notary profile live in the keychain, no secrets in env.
# This script ends at the GitHub Release; `gh release create` mints the tag remotely,
# which triggers the tag workflow's fan-out (tap Cask, Notion, deploy hook).
#
# Usage:
#   scripts/release.sh 0.3.0              # full signed release
#   scripts/release.sh 0.3.0 --unsigned   # skip signing/notarization (pre-cert only)
#   scripts/release.sh 0.3.0 --dry-run    # preflight + gates, then print the plan
#   scripts/release.sh --log              # print commit log since the last tag (for notes)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
WWW="$ROOT/apps/www"
REPO="mitchmalone/scuttler"
NOTARY_PROFILE="launcharr-notary"  # local keychain profile name; not renamed

die() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "── $*"; }

command -v cargo >/dev/null 2>&1 || PATH="$(dirname "$(rustup which cargo)"):$PATH"

if [[ "${1:-}" == "--log" ]]; then
  cd "$ROOT"
  last=$(git describe --tags --abbrev=0 2>/dev/null) || die "no previous tag"
  git log --oneline "$last"..HEAD
  exit 0
fi

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: release.sh X.Y.Z [--unsigned|--dry-run]"
SIGNED=1; DRY=0
for arg in "${@:2}"; do
  case "$arg" in
    --unsigned) SIGNED=0 ;;
    --dry-run)  DRY=1 ;;
    *) die "unknown flag: $arg" ;;
  esac
done
TAG="v$VERSION"
NOTES="$ROOT/docs/releases/$TAG.md"
DIST="$ROOT/dist/$TAG"
ZIP="scuttler-$VERSION.zip"
DMG="scuttler-$VERSION.dmg"
DL="https://github.com/$REPO/releases/download/$TAG"

step "1/8 preflight"
for tool in pnpm cargo gh shasum ditto jq; do
  command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"
done
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || die "dirty tree: $ROOT"
[[ "$(git -C "$ROOT" branch --show-current)" == "main" ]] || die "not on main"
gh auth status >/dev/null 2>&1 || die "gh not authenticated"
visibility=$(gh repo view "$REPO" --json visibility --jq .visibility)
[[ "$visibility" == "PUBLIC" ]] || die "repo $REPO is $visibility — release assets would 404 for brew and the website"
git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1 && die "tag $TAG already exists locally"
git -C "$ROOT" ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 \
  && die "tag $TAG already exists on origin"
[[ -f "$NOTES" ]] || die "release notes missing: docs/releases/$TAG.md (copy _TEMPLATE.md; notes are written BEFORE releasing)"
if [[ "$DRY" == 0 ]] && grep -qE '\| _ (ms|MB)' "$NOTES"; then
  die "release notes still contain placeholder perf numbers"
fi
if [[ "$SIGNED" == 1 ]]; then
  # NB: never `cmd | grep -q` under pipefail — grep's early exit SIGPIPEs the writer
  # and fails the pipeline. Capture first, grep the variable.
  identities=$(security find-identity -v -p codesigning)
  IDENTITY=$(grep -o '"Developer ID Application:[^"]*"' <<<"$identities" | head -1 | tr -d '"') \
    || die "no Developer ID Application identity in keychain (or pass --unsigned)"
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
    || die "notary profile '$NOTARY_PROFILE' not stored (xcrun notarytool store-credentials $NOTARY_PROFILE)"
fi
# The dmg step lays out its window by driving Finder over AppleScript. Without the
# Automation grant macOS prompts once; unanswered, the AppleEvent times out after
# 120 s and bundle_dmg.sh dies mid-build (JOURNAL 2026-10-20). Ask here, where a
# human is watching: this passes, raises the prompt now, or names the fix.
osascript -e 'tell application "Finder" to get name' >/dev/null 2>&1 \
  || die "this terminal may not control Finder, which the dmg layout needs: System Settings → Privacy & Security → Automation"

step "2/8 gates"
cd "$ROOT"
pnpm verify

if [[ "$DRY" == 1 ]]; then
  step "dry run — remaining plan"
  cat <<EOF
  3. bump $VERSION into apps/desktop/{package.json,src-tauri/tauri.conf.json,src-tauri/Cargo.toml}
  4. pnpm --filter @scuttler/desktop tauri build  (signed: $SIGNED; targets: app + dmg)
  5. verify (spctl), package $ZIP + $DMG + SHA256SUMS into dist/$TAG/;
     write apps/www/src/lib/release.json (ships in the release commit)
  6. smoke tests, scripted: fresh profile (cold start, hotkey, setup owed) and the
     upgrade over the running version (user dirs untouched, frecency intact)
  7. commit bump + notes + release.json, push main (no local tag)
  8. gh release create $TAG with artifacts — the remote tag triggers the fan-out
     workflow (tap Cask bump, Notion version, mitchmalone.com deploy hook)
EOF
  exit 0
fi

step "3/8 version bump → $VERSION"
cd "$DESKTOP"
jq ".version = \"$VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json
jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > t.tmp && mv t.tmp src-tauri/tauri.conf.json
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
# jq rewrites JSON in its own layout; put it back in the repo's, or the release
# commit fails CI's format check (the gate above ran before the bump).
pnpm prettier --write package.json src-tauri/tauri.conf.json >/dev/null
(cd src-tauri && { cargo check -q 2>/dev/null || cargo check; })   # refresh Cargo.lock
for v in $(jq -r .version package.json) $(jq -r .version src-tauri/tauri.conf.json); do
  [[ "$v" == "$VERSION" ]] || die "version bump mismatch"
done
cd "$ROOT"

step "4/8 build"
if [[ "$SIGNED" == 1 ]]; then
  export APPLE_SIGNING_IDENTITY="$IDENTITY"
else
  unset APPLE_SIGNING_IDENTITY 2>/dev/null || true
fi
# A dmg run that died leaves its scratch image (rw.<pid>.*.dmg) behind.
rm -f "$DESKTOP"/src-tauri/target/release/bundle/macos/rw.*.dmg
pnpm --filter @scuttler/desktop tauri build
APP_BUNDLE="$DESKTOP/src-tauri/target/release/bundle/macos/scuttler.app"
DMG_SRC=$(find "$DESKTOP"/src-tauri/target/release/bundle/dmg -maxdepth 1 -name "*.dmg" | head -1)
[[ -n "$DMG_SRC" ]] || die "no dmg in the bundle output"

step "5/8 verify, notarize, package"
# The tauri bundler only auto-notarizes via raw APPLE_ID/APPLE_PASSWORD env vars; we
# notarize explicitly with the stored keychain profile instead — no secrets in env.
notarize() { # $1: file to submit
  local out
  out=$(xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1) \
    || { echo "$out" | tail -5; die "notarytool submit failed for $1"; }
  echo "$out" | grep -q "status: Accepted" \
    || { echo "$out" | tail -8; die "notarization not accepted for $1"; }
}
rm -rf "$DIST" && mkdir -p "$DIST"
if [[ "$SIGNED" == 1 ]]; then
  # codesign only prints the cert chain at -dvv; -dv shows no Authority lines.
  sig=$(codesign -dvv "$APP_BUNDLE" 2>&1)
  grep -q "Authority=Developer ID Application" <<<"$sig" || die "app not Developer ID signed"
  ditto -c -k --keepParent "$APP_BUNDLE" "$DIST/$ZIP"
  echo "  notarizing app (zip)…"
  notarize "$DIST/$ZIP"
  xcrun stapler staple "$APP_BUNDLE"
  rm "$DIST/$ZIP" && ditto -c -k --keepParent "$APP_BUNDLE" "$DIST/$ZIP"   # re-zip stapled app
  echo "  notarizing dmg…"
  notarize "$DMG_SRC"
  xcrun stapler staple "$DMG_SRC"
  gatekeeper=$(spctl -a -vv "$APP_BUNDLE" 2>&1 || true)
  grep -q "accepted" <<<"$gatekeeper" || { echo "$gatekeeper"; die "Gatekeeper rejected the app"; }
else
  echo "⚠ UNSIGNED build — brew/source install only; do not advertise the dmg/zip"
  ditto -c -k --keepParent "$APP_BUNDLE" "$DIST/$ZIP"
fi
cp "$DMG_SRC" "$DIST/$DMG"
(cd "$DIST" && shasum -a 256 "$ZIP" "$DMG" > SHA256SUMS)
cat "$DIST/SHA256SUMS"

# Release facts ship in the release commit — the site and the fan-out workflow both
# read this file; the workflow refuses to release if it disagrees with the tag.
ZIP_SHA=$(awk -v f="$ZIP" '$2==f{print $1}' "$DIST/SHA256SUMS")
DMG_SHA=$(awk -v f="$DMG" '$2==f{print $1}' "$DIST/SHA256SUMS")
jq -n --arg v "$VERSION" --arg d "$(date +%Y-%m-%d)" \
      --arg zip "$DL/$ZIP" --arg dmg "$DL/$DMG" \
      --arg zs "$ZIP_SHA" --arg ds "$DMG_SHA" --argjson signed "$SIGNED" \
      '{version:$v, date:$d, signed:($signed==1),
        artifacts:{zip:{url:$zip, sha256:$zs}, dmg:{url:$dmg, sha256:$ds}}}' \
  > "$WWW/src/lib/release.json"
pnpm prettier --write "$WWW/src/lib/release.json" >/dev/null

step "6/8 smoke tests: a fresh profile, then the upgrade over the running version"
# Until 2026-11-01 these were two [y/N] prompts for a human to run by hand; both
# are now checked by the script against what the app itself reports, so a
# release is one command end to end (DECISIONS 2026-11-01). Both stop the
# running app first: a second instance would fight it for the hotkey.
IDENTIFIER=$(jq -r .identifier "$DESKTOP/src-tauri/tauri.conf.json")

# Fresh profile: the zip brew installs, unpacked and launched with an empty
# HOME (the app resolves every path from $HOME), stderr captured — the perf
# lines and breadcrumbs go there. Proves the archive is sound, the app comes
# up inside the cold-start budget, registers its hotkey, and writes a config
# that owes the first-launch setup. A bar and a tray icon show for a few
# seconds while it runs.
echo "  fresh profile…"
"$ROOT/scripts/dev-install.sh" --quit
EXTRACTED="$DIST-extracted"
rm -rf "$EXTRACTED" && mkdir -p "$EXTRACTED"
ditto -x -k "$DIST/$ZIP" "$EXTRACTED"
FRESH_HOME=$(mktemp -d "${TMPDIR:-/tmp}/scuttler-fresh.XXXXXX")
mkdir -p "$FRESH_HOME/Library/Logs"
FRESH_LOG="$FRESH_HOME/stderr.log"
HOME="$FRESH_HOME" "$EXTRACTED/scuttler.app/Contents/MacOS/scuttler" >"$FRESH_LOG" 2>&1 &
FRESH_PID=$!
for _ in $(seq 1 200); do
  grep -q "cold start" "$FRESH_LOG" 2>/dev/null && break
  kill -0 "$FRESH_PID" 2>/dev/null || break
  sleep 0.1
done
sleep 2   # let the config land and the first bar snapshot run
kill -TERM "$FRESH_PID" 2>/dev/null || true
wait "$FRESH_PID" 2>/dev/null || true
cold=$(grep -o 'cold start [0-9]*ms' "$FRESH_LOG" | head -1 | grep -o '[0-9]*' || true)
[[ -n "$cold" ]] || { tail -20 "$FRESH_LOG"; die "fresh profile: the app never reported its cold start"; }
(( cold < 1000 )) || die "fresh profile: cold start ${cold}ms is over the 1 s budget"
if grep -q "hotkey registration failed" "$FRESH_LOG"; then
  grep "hotkey" "$FRESH_LOG"; die "fresh profile: the hotkey did not register"
fi
FRESH_CONFIG="$FRESH_HOME/.config/scuttler/config.json"
[[ -f "$FRESH_CONFIG" ]] || die "fresh profile: no config.json was written"
jq -e '.setupPending == true' "$FRESH_CONFIG" >/dev/null \
  || die "fresh profile: a new config does not owe the first-launch setup"
if grep -qi "panicked" "$FRESH_LOG"; then
  grep -i -A3 "panicked" "$FRESH_LOG"; die "fresh profile: the app panicked"
fi
echo "  fresh profile ok: cold start ${cold}ms, hotkey registered, setup owed"
rm -rf "$FRESH_HOME"

# Upgrade path: this build over the installed one, the way dev-install does
# it (through launchd when the login item is on). Everything the user owns
# must be exactly as it was — config, themes, scripts, hooks, widgets — the
# frecency db still there, and the new version up and reporting its plugins.
echo "  upgrade over the running version…"
USER_DIR="$HOME/.config/scuttler"
FRECENCY_DB="$HOME/Library/Application Support/$IDENTIFIER/scuttler.db"
# Across the rename (DECISIONS 2026-11-01) the installed version's home is the
# previous name's; the first launch moves it, rewrites our own names inside
# config.json and purges the plugin build cache — so those two are left out of
# the "nothing changed" sum, and the move itself is asserted instead.
PREV_USER_DIR="$HOME/.config/scuttlarr"
PREV_FRECENCY_DB="$HOME/Library/Application Support/$IDENTIFIER/scuttlarr.db"
tree_sum() { (cd "$1" && find . -type f ! -name '*.tmp' ! -path './.build/*' ! -name config.json -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-64); }
before_dir="$USER_DIR"; before_db_file="$FRECENCY_DB"
if [[ ! -d "$USER_DIR" && -d "$PREV_USER_DIR" ]]; then
  before_dir="$PREV_USER_DIR"; before_db_file="$PREV_FRECENCY_DB"
  echo "  (upgrading across the rename: $PREV_USER_DIR → $USER_DIR)"
fi
before_tree=$(tree_sum "$before_dir")
before_db=$(stat -f %z "$before_db_file" 2>/dev/null || echo 0)
LOGBOOK="$HOME/Library/Logs/scuttler.log"
before_lines=$(grep -c "" "$LOGBOOK" 2>/dev/null || echo 0)
"$ROOT/scripts/dev-install.sh"
for _ in $(seq 1 300); do
  tail -n "+$((before_lines + 1))" "$LOGBOOK" 2>/dev/null | grep -q "plugin(s):" && break
  sleep 0.1
done
tail -n "+$((before_lines + 1))" "$LOGBOOK" | grep -q "plugin(s):" \
  || die "upgrade path: the new version did not come up (no plugins line in $LOGBOOK)"
installed=$(plutil -extract CFBundleShortVersionString raw /Applications/scuttler.app/Contents/Info.plist)
[[ "$installed" == "$VERSION" ]] || die "upgrade path: /Applications runs $installed, not $VERSION"
[[ -d "$USER_DIR" ]] || die "upgrade path: $USER_DIR missing after upgrade"
[[ "$before_dir" == "$USER_DIR" || ! -e "$PREV_USER_DIR" ]] || die "upgrade path: $PREV_USER_DIR still there after the rename"
after_tree=$(tree_sum "$USER_DIR")
[[ "$after_tree" == "$before_tree" ]] || die "upgrade path: something under $USER_DIR changed on upgrade"
[[ "$(jq -r .theme "$USER_DIR/config.json")" != "scuttlarr" ]] || die "upgrade path: config.json still names the theme scuttlarr"
after_db=$(stat -f %z "$FRECENCY_DB" 2>/dev/null || echo 0)
(( after_db >= before_db )) || die "upgrade path: the frecency db shrank ($before_db → $after_db bytes)"
echo "  upgrade ok: $VERSION running, $USER_DIR untouched, frecency intact"

step "7/8 commit + push (no local tag — gh release create mints it)"
git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json \
        apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
        apps/www/src/lib/release.json "docs/releases/$TAG.md"
# Rerun-safe: a prior attempt may have already committed the bump.
git diff --cached --quiet || git commit -m "chore: release $TAG"
git push origin main

step "8/8 GitHub release (creates the tag → triggers the fan-out workflow)"
gh release create "$TAG" "$DIST/$ZIP" "$DIST/$DMG" "$DIST/SHA256SUMS" \
  --repo "$REPO" --title "scuttler $TAG" --notes-file "$NOTES" \
  --target "$(git rev-parse HEAD)"

echo
echo "✔ scuttler $TAG released. Fan-out (tap, Notion, deploy hook) is CI's job now:"
echo "  gh run watch --repo $REPO \$(gh run list --repo $REPO --workflow release --limit 1 --json databaseId --jq '.[0].databaseId')"
echo "  Post-release: update docs/STATUS.md; announce (deliberate, optional)."
