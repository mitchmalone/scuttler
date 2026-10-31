---
title: Updates: dismiss a package for a day
status: done
created: 2026-11-01
updated: 2026-11-01
links:
  - ./2026-10-31-updates-in-app-upgrades.md
  - ../../PLUGINS.md (Bundled plugins)
---

# Updates: dismiss a package for a day

## Goal

A package whose upgrade keeps failing (or that you do not want today) should stop
counting against you without leaving the picture: one key puts it aside for 24 hours,
the panel still shows where it went, and nothing bulk upgrades it behind your back.

## Context

2026-10-31: `beeper/tap/cli` 0.6.3 fails to install (`bin/beeper` missing in the tap's
formula). The count sat at 1, the cell stayed on, "upgrade everything" re-ran the broken
formula and re-reported "Homebrew failed" every time. Homebrew has `brew pin` for exactly
this, permanent and brew-only; mas and mise have nothing. Mitch proposed: attempt, show
the error, offer "dismiss for 24hr".

## Approach

- **State (`updates.rs`).** `~/.local/state/scuttlarr/updates-dismissed.json`:
  `{"<source>:<name>": {"available": "0.6.3", "until": <epoch>}}`, written whole
  (temp + rename), lapsed entries pruned on save, loaded once per process. The cached
  report stays raw; `report()` applies the dismissals on read (`apply_dismissals`), so a
  dismissal takes effect at once and lapses on its own. A dismissal is keyed to the
  version it was made against: when the manager offers a newer one the row comes back
  early, because the fix may have landed.
- **Report.** `UpdateSource.dismissed: Vec<UpdateItem>` (each with `dismissed_until`);
  `items` is pending only, so the count, the cell, the card and the headline need no
  change. A source with any dismissed package gets its pending packages' own commands
  as its `upgrade_command` (`&&`-joined; empty when nothing is pending), and the
  runner expands its bulk job into one job per pending package. "Upgrade everything"
  recurses per source and so inherits both. `t` on a band hands the same command over.
- **IPC.** No new Tauri command: `{"dismiss":"brew","item":"gcc","hours":24}` and
  `{"restore":"brew","item":"gcc"}` ride `plugin_send` like `upgrade`. Upgrading a
  dismissed package by hand (`↵` on its row, or a per-item upgrade) ends its dismissal.
- **UI.** A failed row grows a "dismiss 24h" button beside its "failed" word; `d` does
  the same on any selected package (and restores a dismissed one). Dismissed packages
  close their manager's group as dim rows ("dismissed · 23 h left", `↵` restores),
  under a clean band too, so nothing silently disappears. The head reads
  "2 updates · 1 manager · 1 dismissed"; the card adds a one-line note per source.

## Steps

- [x] Plan
- [x] Rust: `Dismissal` store, `apply_dismissals`, `dismiss`/`restore`, dismissal-aware
      `jobs_for` and `upgrade_command`, `forget_dismissal` on a hand upgrade (+ tests)
- [x] plugins.rs: `dismiss` / `restore` message arms
- [x] TS model: `dismissed`, `dismissedUntil`, `rowDismissMessage`, `dismissedLeft`,
      dismissed rows in `ledgerRows`, headline (+ tests)
- [x] Panel: `d`, the button on a failed row, the dismissed row; card note; story
- [x] Docs: DECISIONS, PLUGINS.md, STATUS; `pnpm verify`; dev-install

## Acceptance criteria

- [x] `pnpm verify` green
- [x] A dismissed package leaves `items`, the count and the source's command until it
      lapses or its version moves (`a_dismissal_hides_a_package_until_it_lapses_or_the_version_moves`)
- [x] The state file round-trips and prunes lapsed entries
      (`dismissals_round_trip_through_the_state_file_and_drop_lapsed_entries`)
- [ ] Hands-check: `d` on `beeper/tap/cli` drops the count to 0 and the cell hides; the
      panel shows it dim under Homebrew with "23 h left"; `↵` on it brings it back;
      "upgrade everything" with it dismissed runs the other formulae by name

## Out of scope

- Other durations (the state stores an until-timestamp; a 7-day option is a message
  field away).
- Dismissing automatically after a failure: the error should be seen once and decided
  on.
- A "dismissed" section in the card beyond the one-line note.

## Risks / open questions

- The per-item fan-out for a partially dismissed source means several brew boots
  instead of one; a few seconds each, for the rare case.
- `upgrade_command("all")` for the terminal joins per-item commands with `&&`, so a
  failure early in the line stops the rest in the terminal (the in-app queue does not).
  Unchanged from the source-level join.

## Closing note (2026-11-01)

Shipped, dev-installed. The hands-check is Mitch's (STATUS).
