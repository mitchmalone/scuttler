# Learnings

Hard-won knowledge a contributor needs, by topic: symptom → cause → fix. Curated, not a log: an entry earns its place when someone outside the project would otherwise lose time to it. Prune what goes stale.

Dates in parentheses name the original log entry. Code comments that cite `JOURNAL <date>` or a `plans/…` file point at the per-session log and plan files that lived in `docs/` until v0.8.8: read them with `git show v0.8.8:docs/JOURNAL.md` (plans: `git show v0.8.8:docs/plans/done/<file>`, or `active/`). Comments added in 0.9 that cite `JOURNAL 2026-11-2x` or a 2026-11-2x plan point at the 0.9 branch's copies, which never reached main: `git show 0dc6f29:docs/JOURNAL.md` and `git show 0dc6f29:docs/plans/active/<file>`.

## macOS / AppKit / TCC

- Bulk `NSWorkspace.iconForFile` + rasterization leaks ~20–30MB/icon that autoreleasepool and
  `recache()` cannot release — icon extraction MUST run in the `--extract-icons` subprocess
  (2026-08-08).
- `open Foo.app` re-activates a running instance; always `pkill` before relaunching a rebuild.
- TCC judges a child process by the **responsible app's** Info.plist. A helper spawned from
  scuttler.app that touches a privacy-gated API (Bluetooth, camera, …) needs the matching
  `NS…UsageDescription` in `apps/desktop/src-tauri/Info.plist` or it is killed with no prompt —
  the only trace is `~/Library/Logs/DiagnosticReports/<helper>-*.ips` (2026-09-10).
- Spawned CLIs inherit the app's TCC identity: pin their `current_dir` to a directory we own
  and disallow filesystem tools, or macOS prompts "as scuttler" for whatever they scan
  (2026-08-10).
- TCC grants are keyed to the code-signing requirement: an ad-hoc dev build gets a fresh
  cdhash per rebuild and silently loses Screen Recording. Sign dev builds with the Developer
  ID; never launch the binary from a shell to read stderr (the terminal becomes the
  responsible app) (2026-08-17).
- A first `osascript … tell application` blocks inside tccd until the Automation dialog is
  answered — bound every osascript (8 s), run it last, never in a sequential fan-out
  (2026-09-16). Ghostty's `SIGUSR2` config reload is Linux-only (2026-09-11).
- launchd gives a job a bare `PATH` and **no locale**: children that read `LANG` run in C
  (tmux escapes tabs in `-F` output; use `tmux -u`); set the child's PATH yourself; diff
  `ps eww` before and after changing how a process is launched (2026-09-10, 2026-10-01).
- launchd reads a LaunchAgent plist only at bootstrap: patching the file changes nothing for
  the loaded job until `bootout` + `bootstrap`; an app started with `open` is not the job's
  process and is never relaunched (2026-10-01).
- `Instant` stops while the Mac sleeps; a TTL or "checked at" must be wall time (2026-10-18).
- `brew untap --force` uninstalls the tap's casks, the app included; migrate taps by
  installing from the new one first (2026-08-12).
- create-dmg drives Finder over AppleScript: the building terminal needs Automation for
  Finder or the dmg step dies on an unanswered prompt (2026-10-20; `release.sh` preflights it).

## Tauri / WKWebView / NSPanel

- tauri-nspanel branch is `v2.1`; `tauri_panel!`/`panel_event!` macros; keep event handlers
  alive (`std::mem::forget`) — NSWindow delegates are weak.
- The macro's mandatory `-> ()` trips clippy `unused_unit`; allowed crate-wide in lib.rs.
- `tauri.conf.json` assetProtocol requires the `protocol-asset` cargo feature on `tauri`.
- WKWebView throttles JS timers in a window that never becomes key: the bar webview owns
  zero timers, Rust pushes snapshots (`bar-snapshot`, 1 Hz and on triggers); anything a
  plugin UI can change is pushed, never only polled (2026-08-16, 2026-09-10).
- Hover never reaches an accessory app's panel until it is clicked: attach an ActiveAlways
  `NSTrackingArea` (`bar_constrain::enable_hover_events`) (2026-08-16).
- Destroying a converted NSPanel aborts the process (foreign exception through tao); hide
  it, never `destroy()` (2026-08-16).
- Tauri's monitor API is empty for an accessory app and its cursor→monitor lookup mixes
  pixels with points; `screens.rs` asks CoreGraphics directly; display-parameter changes
  surface no event, hence the frame heartbeat (2026-08-16, 2026-08-19).
- HTML5 drag-and-drop is dead unless `disable_drag_drop_handler()` is set on the window —
  wry swallows the NSDraggingDestination path, internal drags included (2026-08-17).
- Moving the checkout invalidates Tauri's build cache (absolute paths in `target/`):
  `cargo clean` first (2026-08-10, 2026-09-14).

## TUI kit (`packages/tui`)

- `.bar button { background: none; border: none }` (0,1,1) outranks a single-class rule on a button. Double the class (`.x.x`, 0,2,0) rather than scoping under `.bar`: the site renders some kit components outside a bar (2026-11-27, the session card's tiles).

- **Keyboard selection must always be scrolled into view — at both ends.** Every selectable
  kit component passes `revealSelected` as the selected element's ref (`ListRow`,
  `SegmentedControl` cursor); it does `scrollIntoView(nearest)` and snaps the panel body to
  the top when the selection is the first thing, so wrap-around from the bottom shows the
  section header too. Bitten twice (wifi 2026-08-16, aerospace strip 2026-08-17).
- `.tui button` resets are `(0,1,1)`; kit component rules must be at least two classes deep
  (`.tui-segmented .tui-segment…`) or the reset silently wins (2026-08-17).
- A click and `↵` on the same row must do the same thing; a batch result must speak for the
  whole batch, not its last job (2026-10-31).

## Agents / Claude Code

- Claude Code keeps `<config>/sessions/<pid>.json` per running session (`status` busy/idle/shell, `tmux` pane, `sessionId`, `name`); a `<pid>.<hash>.key` file sits beside each and is never read. The format is private: parse leniently, and the screen stays the only source for attention (`claude_sessions.rs`, DECISIONS 2026-11-27).

- Claude Code's keychain item is `Claude Code-credentials-<first 8 hex of sha256(config dir)>`
  under `CLAUDE_CONFIG_DIR`; the `oauthAccount` block in that dir's `.claude.json` names the
  login (2026-08-27).
- Claude's background daemon runs the same hooks with `TMUX_PANE` scrubbed: flag those
  sessions `background`, never create a cell for them (2026-08-19). The prompt hook also
  receives harness XML (`<task-notification>`): strip tags before using text as a title
  (2026-10-28).
- herdr's `agent.*` methods take `target`, `pane.*` take `pane_id`; read `herdr api schema`
  (2026-08-18).
- Liveness: check the evidence (pid, pane) before age; a bulk prune that runs before the
  liveness checks deletes live agents; an empty `list-panes` read is not a layout
  (2026-08-26, 2026-10-28). Concurrent socket writers tear a JSON store: one mutex,
  write-temp-then-rename (2026-08-16).

## Engineering rules the code taught us

- A "key is absent" gate across IPC needs the Rust side to model absence (`Option` +
  `skip_serializing_if`), or it is a gate in name only (2026-09-11, 2026-10-19).
- A rename sed must be followed by a grep of the diff for every _historical_ identifier (old
  paths, markers, keychain profile names, `plans/done/` links) and those put back;
  `rename.rs` carries old names as constants on purpose (2026-09-11). Also: a rename moves
  user plugins but must not edit them — keep the old package name as an import alias
  (2026-09-14).
- bash `pipefail` + `grep -q` fails a healthy pipeline (SIGPIPE 141): capture to a variable,
  then grep (2026-08-10). zsh `read -q` reads the terminal, not stdin: run the gate under a
  pty before a release (2026-10-01).
- Autosaving a config the app also watches needs an echo guard (remember the last JSON
  written, drop the matching event) (2026-08-10).
- Any listener that resets `panelMode` must spare the owed first-launch setup (2026-10-20).
- A fixture of five apps proves the scorer's shape; only a dense corpus proves its judgement
  (`packages/core/src/corpus.json`, 2026-09-16).

## Scripts and widgets (user code under Bun)

- Bundled scripts are TypeScript under Bun since v0.6 (`ip.ts`, `json-format.ts`; `lorem` is
  a built-in); the Python twins are parked as `*.py.retired` on first launch. A Python
  script's one trap: the scripts dir is `sys.path[0]`, so a file named after a stdlib module
  shadows it (2026-08-08).
- Guard a `.ts` entry point with `if (import.meta.main)` so the file also imports into a test
  (the bundled scripts and reference widgets do).

## Plugins / Bun

- Bun's `node:crypto` has no `aes-128-ccm` (ECB/CBC/GCM yes); Bun does not load node-gyp
  addons. Hardware access from a service = a small compiled helper on stdio, protocol in
  TypeScript (PLUGINS.md "Hardware is a helper"; 2026-09-10).
- Plugin UI loads as blob: URLs with the app's `react`, `react/jsx-runtime`, `lucide-react`
  and the kit shimmed onto a shared global; `bun build` emits `react/jsx-runtime` under
  `NODE_ENV=production`, so shim that too (2026-08-27). A UI edit rebuilds; only the
  service file's mtime restarts the service.

## www (Next.js site)

- `lucide-react` v1 removed brand icons (Github, Twitter) — brand marks are inline SVGs in
  `packages/tui/src/components/brand-icons.tsx`, imported by the site.
- eslint-config-next 16's `react-hooks/set-state-in-effect` rejects the classic
  `useEffect(() => setMounted(true), [])` hydration guard — use the `useSyncExternalStore`
  mounted pattern (`apps/www/src/lib/app-theme.ts`).
- A Server Component imports kit **leaves** (`@scuttler/tui/themes`, `…/bar`), never the
  root barrel, whose client components pull hooks into a server context. Bitten 2026-08-16
  and 2026-11-01 (four days of failed deploys); `verify:www` builds the site in the gate.
- Vercel's Ignored Build Step: `ignoreCommand` is capped at 256 characters (hence
  `apps/www/scripts/ignore-build.sh`), and `$VERCEL_GIT_PREVIOUS_SHA` can sit outside the
  shallow clone (git exits 128) — build when in doubt (2026-10-18, 2026-11-01).
- The site logo is a `sips` downscale of `apps/desktop/design/menubar-icon-source.png` (the
  repo copy is the source of truth; the design tool cannot serve binaries). Favicons in
  `apps/www/src/app/` are supplied artwork, used verbatim.
- Vercel CLI 61 moved its credential store to `~/.local/share/com.vercel.cli/auth.json`;
  read both locations and take the later-expiring token (2026-10-01).
- `brew upgrade` can exit 0 and leave `opt/<formula>` and `var/homebrew/linked/<formula>`
  pointing at a keg that was never installed; the next upgrade aborts with `Error:
…/Cellar/<formula>/<version> is not a directory`, one formula per run, while `brew
outdated` stays healthy. Removing both links repairs it (2026-11-25).
- The Vercel CLI's token lasts eight hours and an expired one answers 403, not 401. Only
  a CLI run renews it, and the app's bare PATH can't find a version-managed CLI: run it
  as `$SHELL -lic 'vercel whoami'` (2026-11-25).

## Toolchain

- brew's rustup puts cargo proxies in `/opt/homebrew/opt/rustup/bin`, not `~/.cargo/bin`;
  `.lefthookrc` exports it for hooks. `rustup run stable cargo fmt` does NOT work here.
- pnpm 11 hard-fails on unapproved postinstall scripts; approve via `allowBuilds:` in
  `pnpm-workspace.yaml`.
