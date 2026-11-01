---
title: Docs sweep — every doc true against v0.8.0, and a memory receipt that ends the argument
status: active
created: 2026-11-01
updated: 2026-11-01
links:
  - 2026-11-01-rename-to-scuttler.md # the follow-on; runs on the swept docs
  - ../done/2026-10-19-docs-truth-and-stories.md # the last truth pass (README/PRD/ROADMAP)
  - ../../STATUS.md
  - ../../RELEASING.md
  - ../../STANDARDS.md
---

# Docs sweep

## Goal

Every doc reads true against the code on the day it is committed, says each fact once,
and the memory budget has one measurement definition so a release stops re-arguing what
120 MB means. Done before the scuttler rename so the rename's sed turns true text into
true text and the v0.9.0 notes carry the new receipt.

## Context

Audit of 2026-11-01 (read-only; findings file kept in the session scratchpad, condensed
into the steps below). The last truth pass (2026-10-19) covered README, PRD §4–§9 and
ROADMAP; everything else dates from the fold or earlier. What it found, in order of
weight:

- **Memory is told four ways.** Receipts v0.2–v0.6 were main-process RSS (90–118 MB);
  `scripts/mem.sh` (2026-09-16) sums app + helpers; v0.7.0 reported 169 MB on the daily
  config; v0.8.0's table reads 114 MB on a light config while its prose gives 158 MB for
  the like-for-like. STATUS:61 still quotes the September reading; STATUS:74 and the
  cleanup plan say the target is undecided; AGENTS, PRD §7 and the release template say a
  fixed 120. Growth with uptime (120 → 240 MB over 25 h, defaults-flip plan) is recorded
  nowhere a reader looks.
- **SETUP.md describes the two-repo world as current**: a clone under
  `~/.local/share`, `install`/`update` verbs, Brewfile, caps→hyper, duti, a "launcharr
  handshake". The real CLI is `doctor | defaults | shell | link | unlink | migrate |
sudoers | remove | version`. AGENTS.md's setup row and DEVIATIONS ("planned") repeat the
  fiction.
- **STATUS is 212 lines of history** (the standard prunes past ~150); hands-checks go
  back to 0.4.0; one fixed bug (launch toast, 2026-10-20) is listed as not started.
- **Both logs break their newest-first rule**: JOURNAL 957–1133 and DECISIONS 1355–1865
  were appended at the bottom. Fourteen superseded decisions carry no forward marker.
  LEARNINGS has 14 entries, ~40 promotion candidates, and two entries that are now false
  (`brand-icons.tsx`, `theme-switch.tsx`).
- **The site is v0.4-era in places**: `og.png` reads "launcharr — an app launcher for
  pirates"; stats say 3.7 ms / ~96 MB; the roadmap block has Machine, your themes and hot
  editors as todo; "only network call is a favicon"; "⌘Space"; "V0.5" badges on eight
  cards. `/docs` duplicates README Defaults, README Uninstall and SCRIPTS.md and has
  drifted in all three. Invariant 10 breaches confirmed: the demo retypes the launcher
  prompt (the kit exports `Launcher`), `PANEL_INFO` drifted from the registry (no
  `setup`, `theme`, `plugins`), `bar.tsx` and `bar-strip.tsx` duplicate each other.
- **Extension docs triplicate**: THEMES.md and the two theme READMEs share format,
  syntax, token table and surfaces (and say 12 tokens; there are 13). WIDGETS.md documents
  a surface slated to fold into plugins without saying so, and PLUGINS.md defers to it for
  settings/auth/tick. SCRIPTS.md and LEARNINGS carry Python gotchas for scripts that are
  TypeScript.
- **STANDARDS.md is the jig at ef6ba7a (2026-08-11)**; the jig moved 27 lines (stamp
  wording, Infisical for every tier, shared-tap policy, Swift flavor, Neon default).
  DEVIATIONS misses four divergences the standard demands (Bun as plugin runtime,
  `interface`, STATUS length, N/A sections).

## Approach

Six commits, each leaving `pnpm verify` green and each doc it touches true on its own.
Decisions go to DECISIONS first, then get applied. History files (DECISIONS, JOURNAL,
`releases/*`, `plans/done/*`) are re-sorted and marked, never rewritten. Brand assets
(`og.png`, icons, package descriptions) are left for the rename: they would be redone in
weeks.

Ordering alternatives considered: sweep as the rename's last phase (the earlier draft).
Rejected because the rename is a product release with real risk (home migration,
self-update across a repo rename, domain cutover) and may slip, a sed renames stale text
into stale text, and the receipt definition must exist before the v0.9.0 notes are
written.

## Steps

### 1. The memory receipt (DECISIONS, then applied)

- [ ] DECISIONS entry: **the receipt** is `scripts/mem.sh --receipt` on a release build,
      panel hidden, bar on, agents monitor off, no plugin services, one display, 60 s
      after launch, median of three readings; app process plus any always-on helper under
      that config (none today); the Mac is named in the notes. It is the only number
      compared with 120 MB. A second, unbudgeted **daily footprint** line (the author's
      real config, uptime stated) is trend, not budget. The definition-of-done rule
      narrows to: a change that adds something resident records the receipt before and
      after; everything else is covered by the release receipt.
- [ ] `scripts/mem.sh --receipt`: three readings 10 s apart, prints the median, and a
      warning line when plugin services or the agents monitor are running (so the number
      produced is the one claimed). Plain `mem.sh` unchanged.
- [ ] Apply: AGENTS.md perf table footnote + definition-of-done bullet; PRD §7 row;
      `releases/_TEMPLATE.md` (receipt row with config line, footprint row); `_TEMPLATE.md`
      plan checklist line; STATUS memory paragraph replaced by one pointer.
- [ ] ROADMAP: one memory item with triggers — growth with uptime (240 MB at 25 h), and
      whether 120 holds with the bar on by default; borders' footprint as its own line.
- [ ] Take the v0.8.0 receipt under the new definition on the primary Mac and record it in
      the ROADMAP item as the baseline (not in the shipped v0.8.0 notes).

### 2. Cursor docs: STATUS, ROADMAP, PRD

- [ ] STATUS rewritten from the top to one screen: where we are (release + one line per
      thing since), needs Mitch (decisions, then hands-checks for the current release
      only), next (pointers to ROADMAP). Hands-checks older than v0.8.0 become ROADMAP
      rows with triggers or are dropped; the launch-toast ticket (fixed 2026-10-20)
      removed; the travel restore items checked with Mitch and closed.
- [ ] Decide and record the bar default layout: `config.rs` right zone vs
      `DEFAULT_BAR_LAYOUT` (wifi, awake, usage, battery). One default, one source, the
      other derived or deleted; a test pins them equal.
- [ ] ROADMAP collapsed to: shipped (one line per release, linking the notes), open with
      triggers, non-goals. Emoji removed (line 21). Bundled plugins = usage, calendar,
      updates. Slice G stated as "nothing moved yet". Milestone exits marked as history
      where they say launcharr.
- [ ] PRD header (v0.8.0, revised 2026-11-01); §6.2 IPC count points at DECISIONS instead
      of a number; open question 1 closed (⌥Space held by three months of defaults).

### 3. Machine rung and the standard: SETUP, AGENTS row, DEVIATIONS, STANDARDS

- [ ] SETUP.md rewritten from the top against `packages/setup`: what the base is (the
      bundle's `Contents/Resources/setup/`), the real verbs, the real overlay
      (`defaults.sh`, `zsh/`, `ghostty`, `tmux.conf`), the real state (`manifest`,
      `defaults.before`, `adopted/`, `touched/`, `migrations`, `current/theme.name`), the
      five manifest modes, sudoers, reversal. The handshake section becomes one history
      line pointing at DECISIONS 2026-09-11.
- [ ] `packages/setup/README.md` lib list and tense; `migrations/README.md` drops
      `update`; `bin/scuttlarr` header comment.
- [ ] AGENTS.md setup row says what is built; DEVIATIONS rows 2 (smoke tests scripted
      2026-11-01) and 5 (setup built) corrected.
- [ ] STANDARDS.md re-vendored from the jig HEAD (stamp comment updated); DEVIATIONS
      gains the divergences it demands: Bun as the user-plugin runtime, `interface` where
      the standard says `type`, and an N/A line for the web-product sections (Vercel
      pairs, Better Auth, Hono, Zod env). STATUS length stops being a deviation once step
      2 lands.
- [ ] `_TEMPLATE.md` link hint drops the non-existent STACK.md. RELEASING install table
      drops "also the update channel (brew upgrade)" (cask is `auto_updates`); fan-out
      checkbox ticked (all four jobs green on v0.8.0).

### 4. Extension docs: THEMES, WIDGETS, PLUGINS, SCRIPTS

- [ ] Split the theme trio: `packages/theme/README.md` = API and derivation (adds
      `good → green`, `builtin.generated.ts`); THEMES.md = user surfaces and policy (13
      tokens; names `theme_editors.rs`, `user_themes.rs`); `templates/README.md` = the
      surface table only, pointing at both ("every tty", not "tmux panes").
- [ ] WIDGETS.md header states the fold plan (widgets.rs → plugins.rs, ROADMAP) and fixes
      the done-plan link. PLUGINS.md takes ownership of settings/auth/tick definitions so
      the fold can delete WIDGETS.md later without losing them; marks `lights` and
      `amaran` as external examples; documents the `@launcharr/tui` alias.
- [ ] SCRIPTS.md: sample manifest uses a claimable trigger (not `lorem`); Python section
      reduced to one legacy line; "up to 8 items" verified against the code or removed;
      pointer to PLUGINS beside WIDGETS. LEARNINGS "Scripts / Python" rewritten.

### 5. Logs: JOURNAL, DECISIONS, LEARNINGS, plans

- [ ] One re-sort of JOURNAL and DECISIONS to newest-first (move blocks, no edits); a
      JOURNAL line recording that it happened.
- [ ] Forward markers: each superseded DECISIONS entry gets one line "Superseded by
      YYYY-MM-DD <title>" (the fourteen in the audit, plus the two-repo entries the fold
      superseded implicitly). JOURNAL duplicates merged or marked (10-01 locale ×2, 10-20
      launch toast, 10-18 ignored build step, 09-04 Ghostty AppleScript, 08-17 loupe,
      08-19 awake resume, 08-26 list-panes, 08-27 memory pointer).
- [ ] JOURNAL 2026-09-11 theme-policy vs 2026-10-19: the bug is still open
      (`config.rs:267` not an `Option`); it becomes a ROADMAP row, not a sweep fix.
- [ ] LEARNINGS: fix the two false www entries and the Info.plist path; promote the
      durable gotchas (launchd/TCC group, WKWebView timers in never-focused windows,
      NSPanel destroy aborts, CoreGraphics for displays, Claude keychain naming, the
      rename-sed keep-list, RSC imports kit leaves, Vercel `ignoreCommand` cap, agents
      liveness evidence-before-age). Target: every section one screen, each entry one or
      two lines with a date pointer.
- [ ] plans/done: frontmatter added to `bar-zones-and-arranger.md` and
      `omarchy-panels-and-polish.md`; moot checklists struck with one closing line
      (`awake.md` slice E, `config-home-and-themes.md` ~/.launcharr, `project-restructure`
      launcharr-web, `v0.4-desktop-aerospace-borders.md`, `widget-settings.md`); the rest
      left, since STATUS/ROADMAP now carry them.
- [ ] plans/active: `lights-plugin.md` → done with "Nanoleaf blocked on Mitch's
      shortcuts"; `opensource-readiness-review.md` → `planned`, rewritten for the current
      scope (theme, setup, plugin runtime, self-updater), moved to a ROADMAP row with the
      trigger "before the first public announcement".

### 6. Site: copy and invariant 10

- [ ] Copy against v0.8.0: stats row from `release.json`-adjacent constants or removed;
      network sentence matches README Principles; "⌥Space"; agent states by shape in
      `warn`; the eight "V0.5" badges and the v0.4/v0.5 paragraphs gone; roadmap block
      rebuilt from ROADMAP's open list or dropped; AeroSpace workspaces not shown as a
      default cell; install tabs gain `curl | sh` first, Homebrew says `--cask` and that
      `updates ⏎` is the update path; agent monitoring says off by default; the in-app
      updates ledger appears once.
- [ ] `/docs` stops duplicating: config sample rendered from `DEFAULT_BAR_LAYOUT` and
      `Config::default()`-mirroring constants (or deleted in favour of the README table);
      uninstall and scripts sections become one paragraph each plus a link to the GitHub
      doc. Panel list reads from the registry once the extraction below lands.
- [ ] Invariant 10: `PANEL_INFO` deleted; the panels registry's info shape moves to
      `packages/core` (or `packages/tui`) and both app and site import it. The demo
      imports the kit `Launcher`. `bar.tsx` and `bar-strip.tsx` collapse to one component
      whose right zone is `DEFAULT_BAR_LAYOUT`. `CLOSE_MS` imported. `BarThemeScope`
      receives the picked theme (invariant 8).
- [ ] Dead: `ui/tabs.tsx` and `@radix-ui/react-tabs`; `components.json` `@/hooks` alias;
      `tsconfig.tsbuildinfo` ignored. Add `sitemap.ts` and `robots.ts` (static export
      supports both). `public/install` regenerated from `install/install.sh` after fixing
      "Settings → Desktop / Appearance / Machine".
- [ ] Hands-check in a browser (Mitch): home, /docs, demo typing `setup`, `theme`, `ss`;
      theme picker retints the bar strip and spotlight.

### Close

- [ ] Agent memory notes refreshed (amaran → lights, travel note closed, project-layout).
- [ ] STATUS updated; this plan → `done/`; same commit.

## Acceptance criteria

- [ ] A reader can find the memory budget's measurement definition from AGENTS.md in one
      hop, and `scripts/mem.sh --receipt` produces it; v0.9.0's notes will use it.
- [ ] STATUS.md under 120 lines and contains no reading, number or ticket older than
      v0.8.0 without a pointer.
- [ ] `git grep -n "launcharr" -- AGENTS.md README.md docs/*.md` returns only lines that
      say history (the fold, the deprecated cask, the notary profile).
- [ ] SETUP.md names no verb, file or directory that `packages/setup` does not have.
- [ ] JOURNAL and DECISIONS strictly newest-first; every superseded decision names its
      successor.
- [ ] No `PANEL_INFO`, no second launcher prompt, one bar composition in `apps/www`;
      `pnpm verify` (incl. `verify:www`, depcruise layering) green.
- [ ] STANDARDS.md stamp comment names the jig commit it was vendored from, and
      DEVIATIONS lists every divergence found by diffing the repo against it.
- [ ] Memory: not applicable — no process, window, watcher or cache added. The step-1
      receipt is a measurement, recorded as the ROADMAP baseline.

## Out of scope

- The rename (name, domain, repo, bundle id, paths): `2026-11-01-rename-to-scuttler.md`.
- Brand assets on the site (`og.png`, `menubar-icon.png`, package descriptions): rename.
- Rewriting history files to the current name or facts; they are re-sorted and marked only.
- Any product change beyond the invariant-10 extraction the site needs (step 6) and the
  bar-default decision (step 2), both of which are correctness fixes the docs exposed.
- Shrinking memory. This defines how it is measured; the shrink is the ROADMAP item.
- The open-source readiness review itself (re-planned, not run).

## Risks / open questions

- **Receipt config.** "Agents monitor off, no plugin services" measures the app, not the
  daily product. That is the point of a budget (the thing we control), but it means the
  budget can be green while the daily footprint is 158 MB. The footprint line keeps that
  visible. Alternative: budget the daily config at a higher ceiling. Decide in step 1.
- **Re-sorting the logs** is a large, content-free diff on append-only files; do it as a
  commit of its own so blame on the entries survives via `git log -L`.
- **The `/docs` page's fate.** Linking out to GitHub markdown is honest but ugly; keeping
  it means a second copy forever. Lean: keep `/docs` as a short map with links, and let
  the demo be the documentation. Mitch's call when step 6 starts.
- **PANEL_INFO extraction** moves app code into a package: check the depcruise layering
  rules allow `packages/core` to carry the panel info shape without pulling React.
- **Bar default**: picking the TS layout as truth changes nothing for existing configs
  (they persist their own), but changes a fresh install's right zone. Record in DECISIONS.
