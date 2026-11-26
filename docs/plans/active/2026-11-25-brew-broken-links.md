---
title: The updates panel survives Homebrew's half-upgraded formulae
status: active
created: 2026-11-25
updated: 2026-11-25
links:
  - DECISIONS 2026-11-25 (broken Homebrew links)
  - JOURNAL 2026-11-25 (brew exits 0 and leaves dangling links)
---

# The updates panel survives Homebrew's half-upgraded formulae

## Goal

When Homebrew is left with links to kegs that were never installed, the updates panel
and the bar card say so above the packages and offer the fix, instead of failing once
per package with brew's raw error. For 0.9.

## Context

JOURNAL 2026-11-25 has the failure: `opt/<formula>` and `var/homebrew/linked/<formula>`
point at a new version's keg that is not in the Cellar, and every `brew upgrade` aborts
on the first one. scuttler's own "upgrade everything" of 2026-11-22 produced it: brew
ran 178 s, exited 0, and left six formulae this way. Mitch's answers (2026-11-25): ask
before repairing, scan during checks, show it in both the card and the panel above the
package updates, ship in 0.9.

## Approach

`brewlinks.rs` scans the two link directories under `brew --prefix` and classifies each
formula: repairable (an older keg remains) or stale (none does). The brew check carries
the result on its row (`UpdateSource.broken`). The repair is a `host.send` message
(`{ repairLinks: "repairable" | "stale" }`), no new command: Rust rescans, removes only
the dangling symlinks of that class, and logs each path. Wording lives in the plugin's
model.

## Steps

- [x] `brewlinks.rs`: scan, classify, repair, brew's error signature; temp-dir tests
- [x] The brew check reports broken formulae; the prefix comes from `brew --prefix`
- [x] Before queueing: Homebrew is left out of a batch while anything repairable is broken
- [x] On failure: the first dangling-link failure drops the rest of the brew queue
- [x] Panel: fix rows above every source, labelled Enter, `c` copies the `rm`
- [x] Card: the same two blocks with a fix button, above the sources
- [x] brew's error line is explained wherever a failure is shown
- [x] A run that exits 0 and leaves the package listed reads "not upgraded"
- [x] Every run's whole output goes to `~/Library/Logs/scuttler-upgrades/` (last 20)
- [ ] Find why brew exited 0 on 2026-11-22: nothing was outdated to reproduce it with;
      the run logs are there for the next time
- [ ] Live: break a formula's links on purpose, see the row in the panel and the card,
      press Enter, upgrade

## Acceptance criteria

- [x] `pnpm verify` green
- [ ] With a dangling link in the prefix, the card and the panel show the fix above the
      packages, Enter removes only the links, and the formula returns as an update
- [x] Memory: nothing resident added (a scan per brew check, a file per run)

## Out of scope

Repairing without being asked. Any other kind of Homebrew damage (a keg half-written, a
bad bottle). Sending INT before TERM on cancel.

## Risks / open questions

- The cause of the exit-0 run is unknown; this is the safety net, not the cure.
- Whether a stale link alone aborts brew is unknown, so it never blocks an upgrade: it
  is reported and removable, and the fail-fast catches it if it does abort.
- Cancel is TERM then KILL after five seconds and the stall watchdog is KILL outright;
  either can leave this state. The scan on the re-check after every run catches it.
