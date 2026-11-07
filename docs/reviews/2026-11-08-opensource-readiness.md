# Open-source release readiness review · 2026-11-08

Reviewed at commit `0601881` (main `6ef15d8` plus the admin-rule branch). Plan:
`docs/plans/done/opensource-readiness-review.md`. The repo has been public since v0.2.0;
this is the review before the first public _announcement_. Findings are reproducible
and carry evidence; where a reviewer could not settle a point by reading, it is listed
under residual risk rather than passed.

## 1. Surface map

**Shipped artefacts.** `scuttler.app` (Tauri 2, LSUIElement, signed and notarized DMG on
GitHub Releases, Homebrew cask generated into `mitchmalone/homebrew-tap`), the bundled
zsh CLI `Contents/Resources/setup/bin/scuttler`, `install/install.sh` (curl | sh), and
the static site `www.scuttler.app` (Vercel, `output: 'export'`).

**Trust boundaries.**

| Boundary                    | Where                                                                                              | What crosses it                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| WKWebView → Rust            | 82 `#[tauri::command]`s (`lib.rs`), capability `default.json` = `core:default`, `csp: null`        | Panel, settings, bar and loupe windows call commands with user-typed paths, URLs, script names and plugin messages        |
| User plugin / widget → host | `plugins.rs`, `runtime.rs` (Bun), `plugin_send`, `widget_*`, `widget_secrets.rs`                   | Code the user installs runs as the user; Keychain secrets scoped per widget; `host.send` messages dispatched natively     |
| App → root                  | `sudo -n` only (`sleep_override.rs`, `updates.rs` via `localauth.rs`); rule written by             | `pmset -a disablesleep 0\|1`, `mas upgrade\|update` at a pinned path                                                      |
|                             | `authorization.rs` + `sudoers.rs` (admin dialog) or `scuttler sudoers on`                          | The bundled CLI runs as root once to write `/etc/sudoers.d/scuttler`                                                      |
| App → user's home           | `~/.config/scuttler` (config, manifest, plugins, themes), `~/Library/Application Support/<bundle>` | SQLite frecency and icon cache; theme renders, `aerospace.toml`, borders, shell rc edits, macOS defaults via the manifest |
|                             | `~/Library/LaunchAgents/scuttler.plist` (login item), Claude hook entries (`hooks.rs`)             |                                                                                                                           |
| App → network               | `selfupdate.rs` (GitHub releases API + DMG), `favicon.rs` (quicklink hosts), `usage.rs`            | No telemetry (invariant 2). `usage.rs` reads the user's own Anthropic and ChatGPT usage with the CLIs' own credentials    |
|                             | (api.anthropic.com, chatgpt.com), `widgets.rs` (user widgets' fetches)                             |                                                                                                                           |
| App → other processes       | `terminal.rs` (Ghostty via herdr/tmux, AppleScript to iTerm2/Terminal), `commands::execute`,       | Launch, terminal hand-off, `!` scripts, aerospace, wifi, audio, screenshots                                               |
|                             | `run_bang`, `run_script`, `desktop.rs`, `theme*.rs`, `away.rs`, `agents.rs`                        |                                                                                                                           |
| Release pipeline            | `scripts/release.sh`, `.github/workflows/*`, `.github/cask/*`, `SHA256SUMS`, `install/install.sh`  | Signing identity, notarization, tap push; what the self-updater and the installer verify                                  |

**Permissions.** None required (invariant 1). Opt-ins that prompt: Automation for
Ghostty reload and the iTerm2 fallback, Screen Recording for the loupe, the admin dialog
and the LocalAuthentication sheet, each behind a click.

## 2. Method

Five parallel read-only reviews against the same commit, scoped as the plan's steps:
Rust/Tauri boundaries; TypeScript (UI, plugin loader, kit, site, bundled scripts);
`packages/setup`; the release supply chain (with read-only `gh` queries); and automated
hygiene (`cargo audit`, `pnpm audit`, `gitleaks` over full history, repository and test
gaps). Each reported inventory, findings with severity, evidence, impact and
remediation, a "checked, no finding" list and residual risks. This document merges
them; the per-area inventories are in section 7.

## 3. Blockers before announcing

Fix these before the announcement. Each is reproducible; the first two are exploitable
today by any code running as the user.

### B1 · The App Store NOPASSWD rule is root for anything running as the user (Critical)

`packages/setup/lib/sudoers.zsh:50,55` writes
`Cmnd_Alias SCUTTLER_UPDATES = <mas> upgrade, <mas> upgrade *, …` and
`<user> ALL=(root) NOPASSWD: …`, where `<mas>` is whatever `deps::locate("mas")`
found: PATH first, then `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, the mise
shims (`deps.rs:54-67`, `updates.rs:1304-1312`). On this Mac the installed rule names
`/opt/homebrew/bin/mas`, which is `mitch admin` in a `mitch admin` directory. sudo does
not check who owns the command. Any process running as the user (a plugin service, a
widget, a brew or npm postinstall, a browser exploit) replaces or shadows that file and
runs `sudo -n /opt/homebrew/bin/mas upgrade`: root, no password, no sheet, persistent.
The sleep rule is a different class: `/usr/bin/pmset` is SIP-protected with fixed
arguments. DECISIONS 2026-11-06 calls the two "the same class"; 2026-11-07 lists
`NOPASSWD: ALL` as "not chosen". In effect it was chosen. The dialog copy in
`sudoers.rs:23` ("exactly two things") and `sudoers.zsh:6` repeat the claim.

Remediation, one of: (a) at `sudoers install` (already root, behind the dialog) copy the
resolved mas binary to a root-owned path such as `/usr/local/libexec/scuttler/mas`
(root:wheel 0755) and name that path in the rule, re-installing when mas changes (the
status row already detects a differing rule); (b) drop the mas rule and run App Store
upgrades per batch through `authorization::run_as_admin`; (c) the deferred
`SMAppService` helper. Minimum if deferred: refuse to pin a binary whose file or parent
directory is not root-owned, fall back to the sleep-only rule, and rewrite the three
texts above. The CLI path (`scuttler sudoers on`) shipped in v0.8.6, so main carries
this today; the admin-rule branch widens the audience from terminal users to one
click.

### B2 · An installed theme is code: palette values run in the shell, git and Neovim (High)

`packages/theme/src/template.ts:17-19` substitutes `{{ key }}` by raw string
replacement; `palette.ts:71-73` accepts any root key as a string and validates hex
only for keys that get mixed. `p10k-colors.zsh.tpl:6` (`local comment='{{ muted }}'`),
`delta.gitconfig.tpl:5` (`syntax-theme = {{ bat_theme }}`), `neovim.lua.tpl:8` and
`tmux.conf.tpl` carry unvalidated keys into files the user's shell sources on every
prompt (`packages/setup/prompt/p10k.zsh:26`), git includes (`git/scuttler.gitconfig:15`,
so `core.pager` runs on `git diff`) and Neovim loads. Reproduced against the shipped
renderer with a `colors.toml` holding `muted = "'; touch /tmp/pwned #"` and a
`bat_theme` with a newline: the rendered p10k file runs the command and the gitconfig
gains a `[core] pager`. Second vector: `user_themes.rs:19-28` lets a cloned theme ship
`p10k-colors.zsh`, `tmux.conf`, `neovim.lua`, `delta.gitconfig` verbatim as hand files,
while `user_themes.rs:5-6` and `docs/THEMES.md` promise "never scripts" and "themes are
data". Trigger: Settings → Theme → paste a git URL, pick the theme.

Remediation: validate every palette key as `#rrggbb` (or `#rgb`) in `renderTheme`,
constrain `mode`, `bat_theme`, `neovim_colorscheme`, `helix_theme`, `vscode_theme` to
`^[A-Za-z0-9_.-]+$`, reject any value with a newline or quote, with Vitest cases for
each; and either drop the four executable hand files for cloned themes or say in
THEMES.md and the install sheet that installing a theme runs its code.

### B3 · The admin dialog runs unsigned, user-owned shell as root under the user's environment (High, unmerged branch)

On `feat/admin-rule-from-the-app`, `sudoers.rs:81-90` passes
`/bin/zsh -c 'NO_COLOR=1 exec "$0" "$@"' <bundle>/setup/bin/scuttler sudoers install …`
to `AuthorizationExecuteWithPrivileges`. The bundle is user-owned (`drwxr-xr-x mitch
staff /Applications/scuttler.app`, as every cask install is), zsh reads
`$ZDOTDIR/.zshenv` without `-f`, and nothing scrubs the environment: `SCUTTLER_BASE`,
`SCUTTLER_SUDOERS_PATH` (root `install` to any path), `SCUTTLER_SUDOERS_PREVIOUS_PATH`
(root `rm -f` of any path), `SCUTTLER_VISUDO_BIN`, `PATH` (bare `shasum`, `cut`,
`mktemp`, `cat`, `rm`, `id` resolve through it as root), `TMPDIR`. The rule's temp file
is created in `${TMPDIR:-/tmp}` (`sudoers.zsh:87`), checked by `visudo -cf`, then
installed by a second open: a user-owned `TMPDIR` makes that a swap window
(`install` follows symlinks). `--user` is unvalidated and is a full `User_List`:
`--user 'bob ALL=(ALL) NOPASSWD: ALL\nalice'` parses and installs. Also:
`_sc_sudoers_retire_previous` calls `sc_manifest_remove` as root (`sudoers.zsh:69`)
against the comment two lines later, and `sudoers install --mas` with no value loops
forever as root (`sudoers.zsh:79-85`), which under the dialog hangs the reader thread.

Remediation: do not run the zsh CLI as root. The root half is `visudo -cf`,
`install -m 0444`, `rm -f <old>`; build the rule text in Rust (the zsh function is
already pure), create the temp inside `/etc/sudoers.d/` as `.scuttler.XXXXXX` (sudo
ignores dotted names), and call `/usr/sbin/visudo` and `/usr/bin/install` through
`run_as_admin` with absolute paths and `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`. If
the zsh route stays: `/bin/zsh -f`, `env -i`, absolute binaries, ignore every
`SCUTTLER_*` override when EUID is 0, validate `--user` against
`^[a-z_][a-z0-9_.-]*$` and `--mas` as absolute and existing, guard `shift 2`. One live
run of `run_as_admin` on `/usr/bin/env` settles whether HOME, PATH and TMPDIR are
inherited (residual R1). Merge the branch only after this and B1.

### B4 · main and `v*` tags are unprotected, a bot holds write, and every repo security feature is off (High)

`gh api repos/mitchmalone/scuttler/branches/main/protection` → "Branch not protected";
`rulesets` → `[]`; collaborators: `mitchmalone admin`, `beebeebot write` (an autonomous
agent on a Mac Mini). `release.yml:34-35` and `docs/RELEASING.md:55` assume protection
exists. A pushed `v*` tag plus a release with three assets runs the `homebrew` job,
which rewrites `Casks/scuttler.rb` in the tap from that release's `SHA256SUMS`: anyone
with write can redirect `brew install --cask mitchmalone/tap/scuttler`. The
self-updater is not affected (it pins the Developer ID team), every fresh install is.
`security_and_analysis`: secret scanning, push protection and Dependabot all
disabled; no `.github/dependabot.yml`. The tap repo is equally unprotected.

Remediation: a ruleset on `main` (PR required, `verify` required, no force-push or
deletion, admin bypass so `release.sh` step 7 still works) and a tag ruleset on `v*`
restricting creation to the owner; reduce `beebeebot` to triage or keep write behind
those rules; enable secret scanning, push protection, Dependabot alerts; add
`dependabot.yml` for `cargo`, `npm`, `github-actions`; protect the tap's `main`.

### B5 · Shipping dependencies with open advisories (High, routine fixes)

`apps/www/package.json:20` pins `next` at exactly `16.3.0`: `pnpm audit --prod` reports
17 advisories, 5 critical (unauthenticated RCE, patched by 16.3.3 to 16.4.1, `next/og`
RCE, image SSRF) plus transitive `sharp`, `nanoid`, `source-map-js`; latest is 16.4.5.
The site is a static export so the deployed HTML does not run the server paths; the
exposure is the Vercel build and `next dev`. `cargo audit` reports six advisories on
`rustls 0.23.43`, `rustls-webpki 0.103.13`, `webpki-roots` pulled by `ureq 2.12.1`, the
client behind the self-updater's download and the release feed; two weaken certificate
validation (RUSTSEC-2026-0381, -0382). All fixes are semver-compatible: `cargo update
-p rustls -p rustls-webpki -p webpki-roots` and `next` to `^16.4.5` (or record the
exact pin in DEVIATIONS). Neither audit runs in `pnpm verify` or `release.sh`.

## 4. Pre-announcement work

Ordered by value. None blocks the announcement on its own.

**Webview and plugin UI (Medium).** `tauri.conf.json:30` sets `csp: null` and no
page carries a meta CSP; a plugin's `cell.js`/`panel.js` is `import()`ed as a `blob:`
module into the app's realm (`loader.ts:118-123`), where `window.__TAURI_INTERNALS__`
reaches all 82 commands: `write_config` (whole config, so any consent toggle),
`plugin_send("updates", {sudoers:"on"})` (the root dialog), `script_action open <any
path>` (`commands.rs:490-492`, no scheme check, unlike `open_url`), `widget_install`,
`plugin_install`, `theme_install`, `setup_run`, `hooks_install`. `docs/PLUGINS.md:22`
("the UI never calls Tauri") describes a convention. A plugin service already runs as
the user, so no new privilege, but the manifest's `permissions` do not describe this.
Set a CSP (`script-src 'self' blob:`, then check icons, thumbnails and all four
windows live); move consent-changing commands into a capability granted only to the
settings window; restrict `script_action` Open to http(s) or non-executable paths;
rewrite the PLUGINS.md and WIDGETS.md trust paragraphs; record `csp` in DECISIONS.

**Self-update (Medium).** The chain is sound at its end: team-pinned
`codesign --verify --deep --strict`, bundle id and version cross-checked, quarantine
refused, 200 MiB cap, rename swap with rollback. Before that check an
attacker-controlled zip is expanded by `ditto -x -k` and its plist parsed
(`selfupdate.rs:309-370`); `SHA256SUMS` comes from the same release so it is integrity
only; asset URLs are taken verbatim with no host or scheme check; the codesign
requirement accepts any Apple cert for the team, not Developer ID specifically.
Enforce `https://` and GitHub hosts, extract into a fresh `0700` dir after listing
entries for `..` and absolute paths (the zip-slip behaviour of `ditto` is unverified,
R2), tighten the requirement with the Developer ID OIDs, and sign provenance out of
band (`gh attestation` or minisign over `SHA256SUMS` with the key in the binary).

**Release pipeline (Medium).** Actions pinned to mutable tags (`actions/checkout@v4`,
`dtolnay/rust-toolchain@stable`, …) in the job that holds `HOMEBREW_TAP_TOKEN`
(`release.yml:67-92`); `sha_pinning_required: false`. `install/install.sh:48` runs the
Homebrew installer from `HEAD`, has no `main()` wrapper (a truncated download executes
the prefix), and `|| true`s the upgrade. Binaries are built on a laptop with no
attestation (documented as deliberate; decide and record, or add `gh attestation`).
Repo variables interpolated into `run:` at `release.yml:73,89,115,127`. The tap was
hand-edited (`51a4ea9` dropped the AeroSpace dependency) and the generator restored it
at v0.8.6: fix `.github/cask/scuttler.rb` one way or the other. No `gitleaks` or audit
step in CI (hooks only; STANDARDS asks for both); CI runs the gate as two jobs with a
duplicated www build rather than `pnpm verify`.

**Setup CLI (Medium).** `sudoers status` rebuilds the rule from `command -v mas`
rather than the pinned path (`sudoers.zsh:32,149-166`), so from a Finder or
LaunchAgent launch (bare PATH, JOURNAL 2026-09-10) the app reports `ok: false` after a
successful install while `admin_access` says ready: let `status` take `--mas/--user`.
`sc_manifest_add/remove` silently truncate an unreadable manifest to the new line
(`manifest.zsh:25-27`, `emulate -L zsh` disables `err_exit`; reproduced), which loses
every adopted original `remove` would restore. `remove` deletes an edited generated
file instead of moving it aside (`remove.zsh:48-51`); `sc_touched_revert` deletes a
whitespace-only file without checking for a pre-touch copy (`files.zsh:220`);
`sc_write_atomic` drops the file inside a symlinked directory (`core.zsh:69,76`).

**Repository and licences (Low).** No `SECURITY.md`, `CODEOWNERS` or PR template
for an app that writes a sudoers rule and swaps its own bundle; enable private
vulnerability reporting. `THIRD-PARTY-LICENSES.md` covers the herdr catalogue only;
the bundle carries 487 crates including five MPL-2.0 and `tauri-nspanel` with no
licence field: generate it with `cargo about` at release time (invariant 9).
`tauri-nspanel` is a git branch dependency with no `rev` (`Cargo.toml:23`).
`bug.yml` should say not to paste `config.json` or the logbook.

**Code health (Low).** 163 `unwrap/expect` sites outside tests, 143 of them lock
poisoning (`updates.rs`, `plugins.rs`, `widgets.rs`, `agents.rs`); the policy is
defensible but undocumented and unenforced (`clippy::unwrap_used` off): record it or
add a `lock_or_recover` helper. Four `#[allow]`s without a reason (`config.rs:11`,
`lib.rs:3`, `usage.rs:149,636`). `clipboard.rs:73,85` unsafe without SAFETY. 18 of
63 Rust modules untested, including `commands.rs`, `ask.rs`, `widget_secrets.rs`,
`bar_constrain.rs`; no sibling test for `plugins/host.ts` or the four reference
widgets; coverage thresholds on core and theme only. `sh_word` lets a leading `-`
through (`updates.rs:1441`): require `^[0-9]+$` for mas ids. `widgets.rs:865` and
`plugins.rs:1417` accept `http://` for code installs. `wifi.rs:67-76` puts the
password on the `networksetup` argv (CoreWLAN can take it directly). `usage.rs:1-4`
and `favicon.rs:1-3` headers claim no network; both do (consent-gated, user's own
tokens to their issuer). `trmnl.ts:43` interpolates an env value into `zsh -ic`.
`release.sh:140,153` break its own pipefail rule. Thirteen dev-tool majors behind
(DEVIATIONS row 4 covers them).

## 5. Accepted residual risk

Proposed for Mitch's confirmation; each should be a line in DECISIONS or DEVIATIONS
once accepted.

- A plugin or widget service runs as the user with the user's environment
  (PLUGINS.md "like an editor extension"). Plugin UI having the same reach is the
  consequence, once documented (section 4).
- The app bundle in `/Applications` is user-owned, as every cask install is, so
  same-session malware can already edit it; B3 is hardening of the root hop, not a
  new boundary.
- Release binaries are built and signed on one laptop; the Developer ID key is the
  root of trust for the self-updater. Key custody, Vercel and DNS account security
  are outside the repo.
- Clipboard history is plaintext SQLite in the user-only app data dir; concealed and
  transient pasteboard types are honoured.
- `uptime.ts` defaults to the author's status endpoint until the user sets a URL;
  zsh plugins are cloned unpinned at `shell apply` (standard practice).
- Files written by `sc_write_atomic` are 0600; the `defaults` restore is untyped.
- The git history is clean of secrets (gitleaks, 280 commits) and holds only the
  author's own email, a second personal gmail author identity on four commits, and
  test fixtures with `/Users/mitch` paths.

## 6. Tool results

| Tool                                                  | Version | Result                                                                                                                              |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`                                         | CI      | green on `6ef15d8` (main HEAD, parent of the review commit)                                                                         |
| `cargo audit` (desktop)                               | 0.22.2  | 6 vulnerabilities (rustls x4, rustls-webpki, webpki-roots via ureq), 6 unmaintained, 2 unsound (Linux-only `glib`, `tokio` AsyncFd) |
| `cargo audit` (spike)                                 | 0.22.2  | clean                                                                                                                               |
| `pnpm audit --prod`                                   | 11.21.0 | 17: 5 critical, 6 high, 5 moderate, 1 low, all under `next 16.3.0`                                                                  |
| `pnpm audit`                                          | 11.21.0 | 43 (adds vite, vitest, commitlint and eslint transitive dev advisories)                                                             |
| `pnpm outdated -r`                                    | 11.21.0 | 30 outdated, 13 majors behind                                                                                                       |
| `gitleaks git --redact -v`                            | 8.30.1  | full history, 280 commits: no leaks                                                                                                 |
| history pattern grep                                  | git     | 138 hits reviewed: placeholders, CI expressions, fixtures; no credential material                                                   |
| `shasum -c`, `codesign`, `spctl`, `stapler` on v0.8.6 | macOS   | checksums match; Developer ID, hardened runtime, notarized, stapled, no entitlements                                                |
| `zsh packages/setup/scripts/test.zsh`                 | zsh     | 11 files, 292 assertions green                                                                                                      |
| theme injection PoC                                   | node    | reproduced (B2)                                                                                                                     |

Raw outputs: `cargo-audit.txt`, `pnpm-audit*.txt`, `pnpm-outdated.txt`,
`gitleaks-history.txt`, `rust-unwrap-outside-tests.txt`, `rust-untested.txt` were
written to the session scratchpad; the numbers above are what they held.

## 7. Inventory

Every first-party file was assigned to one reviewer; files read fully are the
privileged ones, the rest were read in part or grepped for the patterns named.

- **Rust (63 files).** Fully: `selfupdate`, `authorization`, `sudoers`, `localauth`,
  `sleep_override`, `setup`, `plugins`, `runtime`, `widget_secrets`, `hooks`,
  `commands`, `lib`, `login_item`, `system_commands`, `clipboard`, `error`, `logbook`.
  Partly (the security-relevant windows): `updates`, `deps`, `terminal`, `ask`,
  `frecency`, `config`, `widgets`, `usage`, `theme`, `desktop`, `user_themes`,
  `theme_editors`, `herdr`, `wifi`, `screenshots`, `rename`, `agents`, `bar*`, `power`,
  `permissions`, `favicon`, `indexer`, `away`, `appearance`, `audio`. Header and grep
  (unsafe, spawn, unwrap): the AppKit, CoreAudio, CoreWLAN, window and static-table
  modules.
- **TypeScript.** Fully: `plugins/{loader,host,components}`, `lib/{theme,user-themes,
config-write}`, the four HTML entry pages, `tauri.conf.json`, `capabilities`,
  `packages/theme/src/*` and five templates, `updates/model.ts` command paths,
  `core/url.ts`, `tui/themes.ts`, `apps/www` config, layout, release plumbing and
  installer copy, the reference plugins and widgets. Grepped: every `invoke(` site
  (85 commands), innerHTML/eval/`new Function`, external URLs, routes.
- **packages/setup (54 files).** Fully: `bin/scuttler`, every `lib/*.zsh`, the rename
  migration, the generated shell base, the harness and seven test files. Grepped: the
  static shell, prompt, terminal and git content, the remaining defaults lists.
- **Release.** Fully: `release.sh`, `dev-install.sh`, `mem.sh`, `install/install.sh`,
  both workflows, the cask template, issue templates, `release.json`, `vercel.json`,
  `LICENSE`, `THIRD-PARTY-LICENSES.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`; 30
  read-only `gh` queries against both repos; the v0.8.6 artifacts downloaded and
  verified.
- **Hygiene.** All 655 tracked files by size, mode and name; the full history by
  pattern; `spikes/shell-wkwebview` and `docs/plans/assets` inspected.

### Residual risks that need a live run

- R1: whether `AuthorizationExecuteWithPrivileges` passes the app's HOME, PATH and
  TMPDIR to the tool (point the ignored `authorization` test at `/usr/bin/env`).
- R2: whether `ditto -x -k` writes `..`, absolute or symlink-through entries (the
  check was not run in this session).
- R3: `__TAURI_INTERNALS__.invoke` from a blob module in the panel's devtools.
- R4: whether a panic in a sync command poisons the process or only the call.
- The admin-dialog live run itself (plan `2026-11-07-admin-rule-from-the-app.md`), to
  be done after B1 and B3.
