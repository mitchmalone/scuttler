---
title: Updates that need root run in the panel, approved by Touch ID, Apple Watch or password
status: done
created: 2026-11-06
updated: 2026-11-07
links:
  - DECISIONS 2026-10-01 (awake's sudoers rule — the pattern this extends)
  - DECISIONS 2026-11-06 (this plan's decision)
  - docs/SETUP.md (the sudoers verb)
  - packages/plugins/updates, apps/desktop/src-tauri/src/updates.rs
---

# Updates that need root run in the panel, approved by Touch ID, Apple Watch or password

## Goal

"Upgrade everything" upgrades everything, App Store apps included, from the panel, with
one OS approval sheet (Touch ID, Apple Watch or the account password) and no terminal.
And the runner can never again sit for twenty minutes on a `sudo` nobody can answer.

## Context

Found 2026-11-06. `mas` 7 requires root for `update`/`upgrade` and re-executes itself
under `sudo`. The runner closes stdin assuming `sudo` fails fast without a terminal
(`updates.rs` `upgrade()` doc). It does not: `/etc/pam.d/sudo` starts with `pam_tid.so`,
and from a launchd-spawned app `sudo` neither shows the Touch ID sheet (confirmed: no
prompt appeared on two tries) nor can read a password, so it blocks forever, ignores
SIGTERM while inside PAM, and holds the runner's pipes so the queue behind it never runs.
Mitch killed five of them by hand (SIGKILL works: sudo's real uid is still the user's).

What exists: `scuttler sudoers on` installs a NOPASSWD rule for two `pmset` commands and
`sleep_override.rs` runs `sudo -n` against it (DECISIONS 2026-10-01). The rule file is
root-owned 0444 so the app can read it without sudo. The panel already routes `t` to the
terminal and `c` to the clipboard. The host message for a click is `{ upgrade, item }`;
no Tauri command is involved and none is added here.

## Approach

Root is granted by the existing sudoers rule, extended once; the approval is
LocalAuthentication, not sudo. Two pieces:

1. **The rule.** `sc_sudoers_rule` gains `SCUTTLER_UPDATES`: the resolved `mas` path
   (`command -v mas`, or `SCUTTLER_MAS_BIN`) with `upgrade`, `upgrade *`, `update`,
   `update *`. Same file, same install, same `off`/`remove`. The runner's job for a root
   source is `/usr/bin/sudo -n <that path> upgrade [ids]`, the path taken from the same
   resolution so the strings match sudoers byte for byte. `t` and `c` keep the plain
   `mas upgrade` form, where a tty's sudo prompts properly.
2. **The approval.** Before root jobs are queued, a small `localauth.rs` (objc2 +
   `objc2-local-authentication`, raw bindings in one module with safety comments) runs
   `LAContext.evaluatePolicy(deviceOwnerAuthentication)`: the one system sheet that
   offers Touch ID, Apple Watch and password. Non-root jobs of the same batch start at
   once; root jobs join the queue when the sheet is approved, or are dropped and the
   band says "not approved". Needs no permission grant or entitlement.

Readiness is read, not probed: a root source is `ready` when `/etc/sudoers.d/scuttler`
(or the pre-rename file) names its path, else `needsRule`. A `needsRule` row says so and
offers `scuttler sudoers on` to copy; "upgrade everything" skips it and says so. Mitch
chose this over a terminal hand-off ("the UX is the point") and over an askpass password
row (password only, the one option least wanted).

Independently, the runner stops trusting children: a `sudo` shim first on their PATH
execs `/usr/bin/sudo -n "$@"`, so anything that reaches for root (a cask) fails in
milliseconds with "a password is required" in the tail; children run in their own
process group; cancel is TERM then KILL after a grace; a run with no output for
`UPGRADE_STALL` is killed and says so.

Alternatives considered: a terminal pane (rejected: not the product); `SUDO_ASKPASS` to
a panel row (rejected: password only); an `SMAppService` helper (deferred as in
2026-10-01: signing, XPC, days). The sheet is a UX gate, not a boundary: once the rule
exists anything running as the user can run `mas upgrade` as root. Recorded as such.

## Steps

- [x] `packages/setup/lib/sudoers.zsh`: `SCUTTLER_UPDATES` alias from the resolved mas
      path (omitted with a comment when mas is absent); help text; test with a fake mas.
- [x] `updates.rs`: `SourceDef.root`; `locate`-based root command; `admin` readiness on
      `UpdateSource` read from the rule file (path override for tests); `jobs_for` splits
      root jobs; `Approval` on the report; stall watchdog; process groups; TERM→KILL
      cancel; the `sudo` shim dir written once under the app's state dir and prepended
      to children's PATH. Tests: rule parsing, command building, split, stall.
- [x] `localauth.rs`: `approve(reason) -> Result<bool, String>`, blocking, one module.
      Cargo: `objc2-local-authentication`.
- [x] `packages/plugins/updates`: `admin` and `approval` on the types; `needsRule` row
      copy and `c` target; band lines for pending/declined approval; stalled run line;
      tests in `model.test.ts`; a story for each state.
- [x] Docs: DECISIONS entry; AGENTS invariants 1 and 13 name the carve-outs; SETUP.md
      and the README's `sudoers` line; JOURNAL gotcha (sudo + pam_tid + no tty).
- [x] Mitch ran `scuttler sudoers on` (2026-11-07, after killing the wedged SecurityAgent
      with `kill -9`); the rule names `/opt/homebrew/bin/mas`; `sudo -n mas upgrade` ran
      with no prompt, exit 0. Hand Mirror was no longer outdated by then, so the panel
      run waits for the next App Store update (STATUS).

## Acceptance criteria

- [~] With the rule installed: the approval sheet shows and reports the verdict
  (`cargo test --lib localauth -- --ignored`, 2026-11-07: sheet up, approved, `Ok` in
  2.8 s); the root run under the rule works (`sudo -n mas upgrade`, exit 0, no prompt).
  The two together from `a` in the panel: not yet, no App Store app was outdated.
- [~] Cancel on the sheet: the Declined path is unit-tested (`approvalLine`, `request_approval`
  on `Err`); not exercised live for the same reason.
- [~] Without the rule: `needsRule` rows and `rowCommand` are unit-tested and in stories;
  the installed Mac never ran 0.8.6 without the rule long enough to look.
- [~] A child that calls `sudo` fails within a second: the shim is unit-tested; not seen live.
- [~] A silent child is killed at the stall limit: `stalled` is unit-tested; not seen live.
- [x] `pnpm verify` green; `packages/setup/test/sudoers.test.zsh` covers the new alias.
- [x] Memory: nothing resident is added (the LA context is transient, the shim is a
      file); covered by the release receipt.

## Out of scope

Brew casks that need root (they now fail fast and honestly; joining the rule is a later
call). A privileged helper. Any password field in the prompt.

## Risks / open questions

- `mas upgrade` as root against the user's App Store session: mas 7 documents root as
  required, so this is its supported shape; `sudo -n mas upgrade` ran clean 2026-11-07.
- The rule names the mas path at install time; a moved binary makes `status` report a
  differing rule and the row fall back to `needsRule`.

## Outcome

Shipped in v0.8.6 (2026-11-06). The gating unknown, whether the LocalAuthentication
sheet appears from the app and reports a verdict, was settled live on 2026-11-07 once
the wedged SecurityAgent was killed: sheet up, approved, `Ok`. The sudoers rule installs
with the mas alias and `sudo -n mas upgrade` runs with no prompt. `[~]` above marks what
is unit-tested but not yet watched end to end from the panel; that needs an outdated App
Store app, and STATUS carries it as the next thing to watch rather than open work.
