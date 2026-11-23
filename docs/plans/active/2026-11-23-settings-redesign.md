---
title: Settings redesign — sidebar, pages, search
status: active
created: 2026-11-23
updated: 2026-11-23
links:
  - Claude Design "scuttler settings redesign" (5c47e9db-02f6-429e-a30a-bb3eaaf77604): 01 Current settings, 02 Redesign directions (1a–1e)
  - ROADMAP "settings into panels" (re-decide) — not this; the window stays
---

# Settings redesign — sidebar, pages, search

## Goal

The settings window can hold many more pages: navigation leaves the titlebar for a
grouped sidebar with search, sub-tabs go away, every page shares one layout grammar.
Mitch is adding features to settings next; this is the room for them.

## Context

v0.8.8 settings: 760×720, 7 titlebar tabs, 12 sub-tabs (three of them one row each),
the Theme rung inside General, three layout grammars (160px label grid, full-width
stacks, 140px widget grid), no search. The pain points and the five directions are in
the Claude Design project above; Mitch picked the direction ("those designs are dope")
and asked for it built (2026-11-23). React stays (asked and answered the same day: the
window is created on demand and destroyed on close, so it is outside the receipt).

## Approach

- **Shell**: sidebar (brand, search, grouped pages, rung state, footer) + one page.
  Groups follow the product model: core (Launcher, Bar, Quicklinks, Color picker),
  Rungs (Theme, Desktop, Machine — each shows on/off), Extend (Agents, Plugins,
  Widgets), scuttler (Updates, About).
- **One grammar** (`ui.tsx`): `Page` (icon, title, description, config key, edit) →
  `Section` (uppercase label + bordered box) → `Row` (label + hint left, control
  right) or `Block` (full width for lists and boards). Booleans become toggles.
- **Registry** (`pages.ts`): ids, labels, icons, groups, rung state, legacy hash ids
  (`general`, `menubar`, … → new ids, so `open_settings { tab: 'desktop' }` and old
  links keep working) and the search index.
- **Search** (`search.ts`, pure, tested): the registry's rows matched with
  `@scuttler/core` `fuzzyMatch` (invariant 5 — the same matcher), ⌘F focuses,
  ↑/↓/↵/Esc, Enter jumps to the row and flashes it.
- **Logic stays**: every page moves its existing hooks and invokes over unchanged; only
  the markup changes. No new Tauri command, no new config key.
- Window 1080×720, min 860×560.

## Steps

- [x] Worktree `../scuttler-settings-redesign`, branch `feat/settings-redesign`
- [x] `search.ts` + tests first
- [x] `ui.tsx` primitives, `pages.ts` registry, new `settings.css`
- [x] Pages: Launcher, Bar (+ ZoneBoard), Quicklinks, Color picker, Theme, Desktop,
      Machine, Agents, Plugins, Widgets (+ shared widget settings), Updates, About
- [x] Shell: sidebar, search, hash + `settings-tab` routing, error banner
- [x] Window size in `settings_window.rs`
- [x] `pnpm verify` green
- [x] Browser check against mocked IPC (launcher, theme, bar, desktop, machine, agents,
      search; desktop and agents in solarized-light)
- [ ] Run the installed build and walk every page (checklist below)

## Acceptance criteria

- [ ] Every control from v0.8.8 is reachable and writes the same key (checklist below)
- [ ] Old deep links land on the right page (`#desktop`, `#menubar`, `#general`, …)
- [ ] Search finds rows across pages; Enter lands on the row
- [ ] Every page retints with the theme (tokens only; light themes readable)
- [x] `pnpm verify` green
- [ ] Memory: no change expected (window still created on demand, destroyed on close)

## Manual checklist (native, after `scripts/dev-install.sh --build`)

- [ ] Sidebar drag region moves the window; traffic lights clear the brand
- [ ] Hotkey recorder records and Esc cancels
- [ ] Zone board drag/retire/restore, notched layout toggle
- [ ] Theme pick, mode, pair, Focus, Everywhere apply now
- [ ] Desktop: tiling toggle, adopt prompt deep link from the panel
- [ ] Machine: doctor runs on open, plan/apply gating, admin buttons
- [ ] Plugins and widgets lists, settings, sign-in rows

## Notes

- Also fixed while here: the About footer still said "zero network" (retired
  2026-09-04); it now says no permissions unless you turn something on, no telemetry.
  `usage.rs`'s header said "no network" though limits are one HTTPS request per granted
  provider; corrected.

## Out of scope

Settings-as-a-panel; inline toggles inside search results (design 1c shows them; a
follow-up); new settings. Mitch's extra features come after this lands, same worktree.

## Risks / open questions

- The search index is declared beside the pages, not derived from the rendered rows:
  a renamed row needs its index entry renamed. A test pins every page id in the index.
