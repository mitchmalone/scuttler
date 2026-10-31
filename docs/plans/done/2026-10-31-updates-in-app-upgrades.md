---
title: Updates: upgrade in the app, per package or in bulk; card and panel on the usage design
status: done
created: 2026-10-31
updated: 2026-10-31
links:
  - ../done/updates-upgrade-in-panel.md
  - ../done/app-updates-plugin.md
  - ../../PLUGINS.md (Bundled plugins)
---

# Updates: upgrade in the app, per package or in bulk

## Goal

Nothing in `updates ⏎` should leave scuttlarr. A click on a package upgrades that package;
a click on a source upgrades the source; one key upgrades everything. The hover card and
the panel read like `usage` does, not like a debug dump.

## Context

Field report 2026-10-31: clicking anything in the updates panel did nothing visible.
The logbook has no `upgrade … in panel` breadcrumb ever: a row's click handler copied
the source's command to the clipboard (`host.copy`), and only `↵` ran an upgrade. The
runner (`updates::upgrade`, 2026-09-10) exists but is source-level only and refuses a
second job while one runs, so even a working click could not queue packages.

## Approach

- **Rust (`updates.rs`).** Each `UpdateItem` carries its own `upgrade_command`
  (`brew upgrade gcc`, `brew upgrade --cask repobar`, `mas upgrade 409183694`,
  `pnpm update -g typescript`, `mise upgrade node`; the app's own row keeps the
  selfupdate path). `upgrade(source, item)` enqueues a job instead of refusing: one child
  runs at a time, the queue drains in order, a finished run kicks a re-check. The report
  gains `queue` (jobs waiting), `recent` (the finished runs of this session, bounded) and
  `batch` (`done`/`total` since the queue was last empty) so the UI can mark each row
  queued / upgrading / upgraded / failed and draw one progress meter. `cancel_upgrade`
  kills the child and empties the queue. The `all` job expands to one job per present
  source so a failure in one does not stop the rest. No new Tauri command: the panel still
  speaks through `plugin_send` (`{"upgrade":"brew","item":"gcc"}`).
- **Card (`cell.tsx`).** The usage card's shape: glyph + title + uppercase status line, a
  state badge, one ruled block per source with its items (`name` left, `installed →
available` right, capped), the live run's last line while one runs, a foot hint.
- **Panel (`panel.tsx`).** The ledger (`../assets/updates-panel-options.html`, option A):
  one list, a band per manager with its count chip, command and "upgrade all" button,
  packages under a gutter rule; `↵` or a click upgrades a row and marks it; a long group
  caps at eight with "+N more". "Upgrade everything" in the panel head. The run block is
  one meter line plus the last output line. `t` keeps the terminal hand-off. (The first
  cut used the usage panel's segmented control and tiles; replaced the same day.)

## Steps

- [x] Plan
- [x] Rust: per-item commands in the parsers (+ tests), job queue, batch, recent, cancel
      clears the queue; plugins.rs reads `item`
- [x] TS model: types mirror the report, `upgradeStatus`, `batchProgress`, source tiles (+ tests)
- [x] Card redesign (`bar-updates-*` in bar.css)
- [x] Panel redesign (`tui-updates-*` in styles.css), stories
- [x] Second pass: design asset with three options, Mitch picked A (the ledger); panel,
      card and tests rebuilt on it
- [x] Fixtures shaped like the new report; the site demo still renders
- [x] Docs: DECISIONS, JOURNAL, PLUGINS.md, STATUS; `pnpm verify`; dev-install

## Acceptance criteria

- [x] `pnpm verify` green
- [ ] Clicking a package row in `updates ⏎` starts that package's upgrade and the row says so
      (hands-check, STATUS)
- [ ] Clicking a second row while one runs queues it; the meter shows `1 of 2` (hands-check)
- [x] "Upgrade everything" runs every present source, one after the other, and a failure
      in one does not skip the rest (`pump_runs_queued_jobs_in_order_and_remembers_them`)
- [x] The hover card lists the packages per source and reads like the usage card (stories)
- [ ] Hands-check on the installed app: Homebrew's one outdated formula upgrades from a
      click and the count drops on the re-check

## Out of scope

- A pty for interactive prompts (sudo): `t` stays the route.
- Selecting several packages before starting (a queue of clicks covers it).

## Risks / open questions

- `mas upgrade <id>` may need the App Store signed in; its failure shows as the run's exit
  line, same as before.
- `mise upgrade <tool>` upgrades within the requested range, which is what
  `mise outdated` reports as `latest`.

## Closing note (2026-10-31)

Shipped on main, dev-installed. The two click-driven acceptance items are Mitch's
hands-check (STATUS); the queue, batch and per-item commands are pinned by Rust and
Vitest tests. Found on the way: the dangling `~/.local/bin/pnpm` shim (JOURNAL).
