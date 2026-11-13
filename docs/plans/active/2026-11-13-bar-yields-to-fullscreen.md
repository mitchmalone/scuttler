---
title: The bar steps aside for fullscreen apps
status: active
created: 2026-11-13
updated: 2026-11-13
links:
  - DECISIONS 2026-11-13
---

# The bar steps aside for fullscreen apps

## Goal

A game in borderless fullscreen (World of Warcraft, "Windowed (Fullscreen)") draws its
own top strip where the bar sits, so the bar clips the game's UI. While the app in front
covers a whole display, the bar on that display hides; it returns on switching away.

## Context

- The bar is a floating-level (4) panel, 30 pt tall, on every Space (`bar.rs` `build`).
  WoW's window is a normal-level (0) window whose frame equals the display's
  (measured 2026-11-13: 2560x1440 at 0,0), so the bar is simply above it.
- A tiled window never reaches y=0 (the bar's gap), so "covers the whole display" is a
  clean signal with no list of games to maintain.
- Workspace assignment for the game is AeroSpace's business and another session's work;
  this plan touches only the bar.

## Approach

`cover.rs`: one `CGWindowListCopyWindowInfo` read (bounds, layer, alpha, owner pid;
none of it behind Screen Recording) and a pure `covered(windows, front_pid, screens)`.
`bar.rs` keeps the covered display ids and `sync` hides the bar on them through the
existing hide path. The read costs about 3.6 ms (200 calls, 24 windows, this machine),
so it never runs per tick: it runs for 2.5 s after an app activation, a Space change or
an AeroSpace workspace trigger, and on the existing 5 s heartbeat as the backstop for a
window that goes fullscreen while its app is already in front. `bar.hideOverFullscreen`
(default on) turns it off, and off asks the window server nothing.

Not chosen: `LSApplicationCategoryType` (WoW declares `role-playing-games`, many
non-App Store games declare nothing, and a small windowed game should keep the bar); a
bundle-id list (manual); lowering the bar's level (it would sink under every window).

## Steps

- [x] `cover.rs` with unit tests first (the WoW frame, behind-a-terminal, tiled,
      second display, overlays, slack)
- [x] `front_app::pid`, and the Space-change notification beside activation
- [x] `bar.rs`: covered set, `look`, hide in `sync`, no hover into a hidden bar
- [x] `bar.hideOverFullscreen` in config.rs, config.ts, Settings → Menubar → Layout
- [x] Live read of the window server parses (bar at layer 4, 2560x30)
- [ ] Live, installed build, with WoW in "Windowed (Fullscreen)":
  - [ ] click into the game: the bar is gone within a second
  - [ ] switch to the terminal on the same display: the bar is back
  - [ ] launch the game from cold: the bar goes within 5 s of the window appearing
  - [ ] cursor at the top edge in game: no bar card opens
  - [ ] Settings toggle off: the bar returns over the game; on: it hides again
  - [ ] native fullscreen (a browser video): the bar hides, and returns on leaving
  - [ ] summon the launcher over the game: it still comes up and Esc returns focus

## Acceptance criteria

- [x] `pnpm verify` green
- [ ] The live checklist above
- [x] Memory: nothing resident added (no process, window, watcher thread or cache; one
      more notification observer on the existing block). Covered by the release receipt.

## Out of scope

AeroSpace rules for the game's workspace. Hiding for a non-frontmost fullscreen window
(a game behind a terminal keeps the bar: the terminal is what is being used).

## Risks / open questions

- An app that keeps a transparent, full-display, normal-level window while in front
  would hide the bar. None seen; the toggle is the escape, a `bar.` exclusion list the
  follow-up if one turns up.
- A window that goes borderless-fullscreen while already in front, with no Space
  change, waits for the heartbeat: up to 5 s.
