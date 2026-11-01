---
title: Rename scuttlarr to scuttler, everywhere, at www.scuttler.app
status: active # phases 0–2 and 4 done 2026-11-01; phase 3 (the release) is Mitch's hands
created: 2026-11-01
updated: 2026-11-01
links:
  - 2026-11-01-docs-sweep.md # runs first; this plan's sed then renames true text
  - ../done/2026-09-11-unify-into-scuttlarr.md
  - ../../RELEASING.md
  - ../../SETUP.md
  - ../../STATUS.md
---

# Rename to scuttler

## Goal

One name, simpler to say and type: **scuttler** (always lowercase), at
**www.scuttler.app** (canonical host, with `www`). Everything renames, the repo included;
an installed scuttlarr upgrades to scuttler with nothing to do by hand. The docs sweep
(`2026-11-01-docs-sweep.md`) runs first on the old name, so this plan's sed turns true
text into true text; brand assets it left behind land here. Tagline stays: _Scuttle the
ship. Sail the wreck._

## Context

- Decided 2026-11-01 (Mitch). Second rename: launcharr → scuttlarr on 2026-09-11 left the
  machinery this one reuses: `rename.rs` (one-shot home migration, 171 lines), the tap's
  deprecated-alias pattern (`launcharr.rb` → `scuttlarr`), and the `@launcharr/tui` import
  alias kept so pre-rename user plugins still build (commit d217897).
- Scale (tracked files, case-insensitive): ~1,800 occurrences in ~300 files.
  src-tauri 402 · desktop src 254 · setup 279 · docs 365 · www 128 · theme 76 · tui 53 ·
  core 52 · README 38. Five paths carry the name: `.github/cask/scuttlarr.rb`,
  `apps/desktop/src/settings/scuttlarr.svg`, `packages/setup/bin/scuttlarr`,
  `packages/setup/git/scuttlarr.gitconfig`, `packages/theme/themes/scuttlarr/colors.toml`.
- Identifiers on the user's machine today: bundle id `com.mitchmalone.scuttlarr`;
  `~/.config/scuttlarr` (config, scripts, plugins, widgets, hooks, themes, triggers,
  `.build`); `~/.local/state/scuttlarr` (manifest, agents socket, awake, `current/theme/`,
  `updates-dismissed.json`); `~/.local/share/scuttlarr` (mirrors, zsh plugins);
  `~/Library/Application Support/com.mitchmalone.scuttlarr`;
  `~/Library/LaunchAgents/scuttlarr.plist`; Keychain service `scuttlarr`
  (`widget_secrets.rs`); `/etc/sudoers.d/scuttlarr` (root-owned); the Claude Code hook at
  `~/.config/scuttlarr/hooks/claude-status.py` referenced from `~/.claude*/settings.json`;
  editor artefacts (`~/.vscode/extensions/scuttlarr.theme-0.0.1`, `workbench.colorTheme:
"scuttlarr"`, Zed/btop/helix theme files, `.bak-scuttlarr` backups,
  `~/.claude/themes/scuttlarr.json` + `custom:scuttlarr`); the shell base's generated
  files (`~/.zshrc`, ghostty, tmux, p10k, git include) which **import from
  `~/.local/state/scuttlarr/current/theme/`** by absolute path.
- Config values that are names, not paths: `theme: "scuttlarr"` (default built-in theme),
  `appearance.pair.{light,dark}`, `appearance.focus.*`, `themes.scuttlarr` overrides.
- External: GitHub repo `mitchmalone/scuttlarr` (`mitchmalone/scuttler` is free as of
  2026-11-01); tap `Casks/scuttlarr.rb`; domain `scuttler.app` on Cloudflare, and **every
  old domain already redirects to `www.scuttler.app`** (Mitch, 2026-11-01), so the
  canonical host carries `www` and the apex redirects to it; Vercel project
  `scuttlarr-web`; Notion row "Scuttlarr" (release fan-out); notary keychain profile
  `launcharr-notary` (stays, never renamed; physics).
- Site state the sweep leaves for this plan: `page-theme.ts:19` `localStorage` key
  `scuttlarr-theme` (read as a fallback or every visitor's picked theme resets);
  `public/og.png` (still the launcharr artwork), `public/menubar-icon.png`, the www
  `package.json` description.
- App state found 2026-11-01 beyond the first draft: custom shortcuts are stored by row
  name ("scuttlarr — Theme switcher", `indexer.rs:138–169`, matched in `commands.rs:452`)
  and the built-in item ids `scuttlarr:*` key frecency history; both need a rewrite in the
  config/db migration. Keychain service `scuttlarr` (`widget_secrets.rs:14`), the
  shared-module global `__scuttlarrShared` (`loader.ts`), env vars `SCUTTLARR_PLUGIN` and
  `SCUTTLARR_AGENT_PID` are read by user code (plugins, the Claude hook).
- Self-update coupling: `selfupdate.rs` hard-codes
  `api.github.com/repos/mitchmalone/scuttlarr/releases/latest` and swaps the bundle in
  place by renames. GitHub redirects a renamed repo's API URLs, so a 0.8.0 install keeps
  finding releases. The 0.8.0 → 0.9.0 hop is the one upgrade path that crosses the
  rename and must be hands-checked (step 6).
- Workbench story titles: an external screenshot script keys on them (STATUS). Any title
  containing the name changes only with Mitch's say-so; none do today (grep clean).
- Mitch's dotfiles (chezmoi) write `~/.config/scuttlarr/` and carry the aerospace
  triggers change uncommitted (STATUS). His repo, his step.

## Approach

**Changed on the day (Mitch, 2026-11-01): v0.8.1, not v0.9.0** — a docs-and-rename
release carries no feature. **And the bundle id stays `com.mitchmalone.scuttlarr`**:
`selfupdate.rs` refuses a downloaded bundle whose id differs from the running one, so a
new id would have broken the single upgrade path this release depends on, and it would
have reset every TCC grant for nothing the user can see. The id is opaque; the
Application Support dir stays put (only `scuttlarr.db` inside it renames). Recorded in
DECISIONS 2026-11-01.

Ship it as **v0.8.1**, one release whose only breaking change is the name, with the
migration doing all the work. Mechanical rename first (one commit, sed over the tree plus
the five path moves, verify green), then the migration and compatibility shims, then the
external moves in the release itself, then the few things the sweep left for the new name.

Migration strategy (`rename.rs`, second hop; same shape as the first):

- **Move** `.config`, `.local/state`, `.local/share`, Application Support, and remove
  the old LaunchAgent plist; the login item re-registers under the new bundle id on first
  launch (as last time).
- **Leave a symlink** `~/.local/state/scuttlarr → scuttler` for one release, because the
  user's generated shell files import the theme by that absolute path and a hard break
  would leave every terminal unthemed until `scuttlarr shell --apply` runs. The Machine
  rung's `doctor`/`shell --apply` re-renders to the new path; the symlink is removed by a
  setup migration (`packages/setup/migrations/`) once the manifest shows no old path.
  Decision to record: symlink for the state dir only, not for config (one owner).
- **Rewrite names inside config**: `theme`, `appearance.pair`, `appearance.focus`,
  `themes.scuttlarr` → `scuttler`. Idempotent; the built-in theme dir renames with it.
- **Keychain**: read the old service as a fallback when the new one is empty; copy forward
  on first successful read; never delete the old (user's data).
- **Hook**: `hooks::boot` already completes partial installs; extend it to rewrite the
  command path in `~/.claude*/settings.json` entries whose signature ends in
  `/hooks/claude-status.py` (the file is ours by that signature already).
- **Sudoers**: root-owned, the app cannot move it. The app reads either path; the
  Settings row says "re-run `scuttler sudoers on`" when only the old one exists. Old file
  removed by `scuttler sudoers on` (it has root at that moment).
- **Editors / Claude theme**: next `apply` installs under the new name and switches the
  settings key; old extension dirs and `.bak-scuttlarr` left as history (as the first
  rename left `.bak-launcharr`). `custom:scuttler` is a one-time pick again, said in the
  release notes.
- **Plugin imports**: keep `@scuttlarr/tui`, `@scuttlarr/core` as aliases in the plugin
  bundler so user plugins (lights, amaran, mirror clones) build unchanged; the
  `@launcharr/tui` alias retires in the same commit (two hops is enough).
- **Env vars**: `SCUTTLER_*`; the setup CLI reads `SCUTTLARR_*` as fallback for one
  release (tests point at the dirs through these).

External moves, in this order, inside `release.sh 0.9.0`'s window:

1. `gh repo rename scuttler` (GitHub redirects old URLs, git remotes keep working; update
   `origin` locally anyway). `RELEASES_LATEST`, `REPO`, cask URL, site `GITHUB_URL` all
   point at the new name in the release commit.
2. Tap: workflow writes `Casks/scuttler.rb`; `scuttlarr.rb` gets
   `deprecate! date: "<release date>", because: "is now scuttler", replacement_cask:
"scuttler"` once, like `launcharr.rb` did; `launcharr.rb` stays as is.
3. Site: Vercel project renamed and `www.scuttler.app` attached as its production domain
   (the redirects from `scuttlarr.com` and the apex already point there, Mitch
   2026-11-01; they stay for as long as the old domain is paid for, since the 0.8.0
   README, installer and cask homepage point at it). `metadataBase`
   `https://www.scuttler.app`, install URL `https://www.scuttler.app/install`, cask
   `homepage`, Settings About links, `install/install.sh` header. `sitemap.ts`/`robots.ts`
   (added by the sweep) emit the www host.
4. Notion fan-out: the row renames; `NOTION_RELEASE_PAGE` unchanged (it's an id).

## Steps

Phase 0 — gate

- [x] v0.8.0 released and STATUS says so. Nothing below starts before.
- [x] This file moves to `docs/plans/active/2026-11-01-rename-to-scuttler.md`; DECISIONS
      entry (name, domain, version, bundle id kept, symlink-for-state-only, alias policy,
      what is left behind).

Phase 1 — mechanical rename (one commit, `pnpm verify` green)

- [x] `git mv` the five named paths; sed `scuttlarr` → `scuttler` and `SCUTTLARR_` →
      `SCUTTLER_` across tracked files **except** `docs/DECISIONS.md`, `docs/JOURNAL.md`,
      `docs/releases/*`, `docs/plans/done/*` (history keeps the old name), and the
      compatibility constants introduced in phase 2.
- [x] ~~Bundle id `com.mitchmalone.scuttler`~~ (kept, see Approach); package scopes
      `@scuttler/*`; Rust crate; `bin/scuttler`; perf/log prefixes `[scuttler …]`; the
      built-in theme `scuttler`.
- [x] Workbench story titles unchanged; grep proves it. The one title carrying the name,
      `Grow scuttlarr into an Omarchy-style bar`, is kept.
- [x] `pnpm verify`. — [ ] `scripts/dev-install.sh --build` on the primary Mac; the app
      runs with a fresh profile (Mitch: the agent cannot relaunch the running app).

Phase 2 — migration and shims (TDD in `rename.rs`, `hooks.rs`, `widget_secrets.rs`,
`config.rs`, setup `lib/`)

- [x] `rename.rs`: second hop (dirs, plist, `scuttlarr.db`), state-dir symlink, config
      name rewrite (theme, pair, focus, `themes` key, shortcuts by row name), bundle
      folder rename + relaunch on first launch; frecency `scuttlarr:*` ids rewritten in
      `frecency::open`; tests mirror the launcharr ones.
- [x] Keychain fallback + copy-forward; sudoers: `status` reports the pre-rename file as
      on, `on` and `off` remove it (the rule itself grants by content, not filename, so
      no Settings copy was needed); hook path rewrite was already `hooks::boot`'s stale-
      path mend — test now proves it against the old config path.
- [x] Plugin bundler alias `@scuttlarr/tui` → the kit; `@launcharr/tui` retired.
- [x] Setup CLI: `SCUTTLARR_STATE/OVERLAY/NO_NETWORK` fallback; previous-name touched
      markers still recognised; `migrations/2026-11-01-rename-to-scuttler.zsh` re-renders
      the shell base, retires `scuttlarr.gitconfig`, removes the symlink when no owned
      file still imports the old path (`test/rename.test.zsh`).
- [ ] (Mitch) Dev-install on the primary Mac over the live 0.8.0 profile: bar, launcher, theme
      rung, agents, usage, updates, awake, lights plugin all up; terminals still themed
      (symlink); `scuttler shell --apply` then `doctor` clean; symlink gone after the
      setup migration.

Phase 3 — release v0.8.1

- [x] `releases/v0.8.1.md`: breaking change is the name; what migrates by itself, what
      is a one-time pick again (`custom:scuttler`, `scuttler sudoers on`), what is left
      behind on purpose. Perf receipts per the memory-receipt definition (docs sweep
      finding 1, decided before this release).
- [ ] `gh repo rename`; `origin` updated; `RELEASES_LATEST`, `REPO`, cask template, site
      constants in the release commit.
- [ ] Workflow: `Casks/scuttler.rb` written; `scuttlarr.rb` deprecated once; fan-out
      green; Notion row renamed.
- [ ] Site live at `www.scuttler.app`; `scuttlarr.com` and the apex redirect to it;
      `curl -fsSL https://www.scuttler.app/install | sh` works, and the old URL follows the
      redirect (`curl -L`; check the installer's own `curl -fsSL` line too).
- [ ] Hands-check the one cross-rename upgrade: a 0.8.0 install runs `updates ⏎` → `↵`,
      lands as `scuttler.app` in `/Applications`, relaunches, profile migrated. And the
      brew path: `brew upgrade` reports the deprecation, and installing the new cask
      over the top (`brew install --cask mitchmalone/tap/scuttler`) migrates the same way.

Phase 4 — what the sweep left for the new name

- [ ] Brand assets: `public/og.png` and `public/menubar-icon.png` redrawn as scuttler
      (Mitch, through Claude Design — the agent draws no pixels); the Claude Design
      project title if it is renamed. — [x] www `package.json` description.
- [x] `localStorage` key `scuttlarr-theme` read as a fallback for one release.
- [x] Current-state docs re-read once on the new name (README, AGENTS, SETUP, THEMES,
      PLUGINS, WIDGETS, SCRIPTS, RELEASING, STATUS, ROADMAP, PRD): the sed is mechanical,
      the sentences around it may not be ("the first release as scuttlarr", "upgrading
      from launcharr" becomes a two-hop note).
- [x] History files untouched (DECISIONS, JOURNAL, `releases/*`, `plans/done/*`), the
      keep-list honoured (`rename.rs` constants, both deprecated casks, `launcharr-notary`,
      `.bak-*` names, legacy ownership prefixes, `@launcharr/tui` → retired,
      `@scuttlarr/tui` alias).

Close

- [x] Memory notes (agent memory dir) updated: product name (the repo path follows the
      GitHub rename, Mitch's step).
- [ ] Mitch: dotfiles `~/.config/scuttler/`, aerospace triggers commit.
- [ ] STATUS, plan → done, same commit.

## Acceptance criteria

- [ ] `git grep -i scuttlarr` outside history files and the compatibility constants
      returns nothing.
- [ ] A 0.8.0 profile upgraded by self-update and by brew both come up with no hand
      step except the two named one-time picks; `scuttler doctor` clean after
      `shell --apply`.
- [ ] Fresh install from `curl -fsSL https://scuttler.app/install | sh` works; the old
      URL redirects to it.
- [ ] `pnpm verify` green; CI green; fan-out green; tap has `scuttler.rb` and a
      deprecated `scuttlarr.rb`.
- [ ] Memory: `scripts/mem.sh --receipt` before → after on the primary Mac; the rename
      adds no process.
- [ ] Every current-state doc reads true on the release date; `og.png` shows scuttler.

## Out of scope

- Renaming the notary profile (`launcharr-notary` stays; local keychain, physics).
- Moving `~/Library/Logs/scuttlarr.log` or `.bak-scuttlarr` files (history, cheap to
  leave; same call as the first rename).
- Rewriting history docs (DECISIONS, JOURNAL, release notes, done plans) to the new name.
- Any product change. v0.8.1 is the name and the docs, nothing else.

## Risks / open questions

- **Self-update across the rename.** The 0.8.0 updater swaps the bundle it downloads into
  the running bundle's path, so `/Applications/scuttlarr.app` would hold scuttler's
  bundle under the old folder name. Either the 0.9.0 first launch renames its own bundle
  (it has write access to `/Applications` in the common case) or the notes say brew is
  the path. Decide in phase 2 after reading `selfupdate.rs`'s swap step.
- **TCC and Bluetooth.** A new bundle id resets Automation and Screen Recording grants
  and the Bluetooth usage consent for the lights helper. Expected; said in the notes.
- **Symlink vs re-render.** The state-dir symlink is a compromise against "one owner";
  if the setup migration can run on first launch in every configuration (Machine rung off
  included), the symlink can go sooner.
- **Domain cut-over.** `scuttlarr.com` is in the 0.8.0 README, installer, cask homepage
  and every old release note. The redirect (live since 2026-11-01) is load-bearing for as
  long as a 0.8.0 install exists; the old domain's renewal date goes in STATUS.
- **Search and the name.** "scuttler" collides with common English in a way "scuttlarr"
  did not; the site's metadata and the GitHub description carry "scuttler.app" and the
  tagline so a search lands.
