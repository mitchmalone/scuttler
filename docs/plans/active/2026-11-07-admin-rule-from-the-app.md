---
title: The admin rule installs from the app, one system password dialog, no terminal
status: active
created: 2026-11-07
updated: 2026-11-07
links:
  - docs/plans/done/2026-11-06-admin-updates-in-panel.md (the rule and the approval sheet this builds on)
  - DECISIONS 2026-10-01 (awake's rule), 2026-11-06 (root upgrades behind the sheet)
  - docs/SETUP.md (the sudoers verb), packages/setup/lib/sudoers.zsh
  - apps/desktop/src-tauri/src/setup.rs (SetupVerb, `setup_run`), plugins.rs `native_send`
---

# The admin rule installs from the app, one system password dialog, no terminal

## Goal

An end user installs scuttler, presses Enter on a row (or flips a Settings toggle), types
their Mac password once into the system's own dialog, and from then on App Store updates
and awake's sleep switch work from the panel behind Touch ID. Nobody opens a terminal,
finds the bundle path, or runs `scuttler sudoers on`. Mitch's bar, 2026-11-07: "Install
the app. Confirm via a dialogue (or some other equally simple way)."

## Context

v0.8.6 made mas a root source gated by the LocalAuthentication sheet, but getting the
sudoers rule in place still meant a terminal: the CLI is not on PATH until `scuttler
link`, and `scuttler sudoers on` wants sudo, which on this Mac hung behind pam_tid
(JOURNAL 2026-11-06). The row says "needs setup once · scuttler sudoers on in a
terminal · c copies it". That is the whole gap.

Spike 2026-11-07 (four runs, Mitch at the Mac): `osascript -e 'do shell script … with
administrator privileges with prompt "…"'` shows the system admin-rights dialog, runs the
command as root (`id -u` → 0), returns in under ten seconds, and the body text is ours.
The dialog is **password only**, lid open or closed; Touch ID is not offered for
`system.privilege.admin` and the rights database is root-owned, so that cannot change
from our side. From a terminal the header reads "osascript wants to make changes"; called
in-process through Authorization Services it should name scuttler with its icon (step 1
confirms). `security-framework = "3"` is already a dependency and wraps
`AuthorizationExecuteWithPrivileges` (`Authorization::execute_with_privileges`).

What exists and is reused whole: `sc_sudoers_rule` (the single source of the rule text,
visudo-checked), the manifest (one owner per path, invariant 11), `admin_access()` in
`updates.rs` reading the rule file, `needsRule` rows in the updates model, the
`SetupVerb`/`setup_run` command and `runSetup()` in Settings, `native_send` for
`host.send` messages.

## Approach

Keep the sudoers allowlist exactly as it is; change only who writes the file. The app
runs the CLI's own install step **as root under the system admin dialog**, from a
click, then records the manifest as the user. Nothing in the app ever asks for a password
itself; the dialog is Apple's, same class as the file picker and the approval sheet: a
third OS-sheet exception to invariant 13, recorded in DECISIONS.

Shape:

- `packages/setup`: split the root half out of `sudoers on` into an internal verb,
  `scuttler sudoers install --mas <path>` (write the temp file, `visudo -cf`, `install
-m 0444 -o root -g wheel`, retire the pre-rename file) that runs **directly** when
  `EUID == 0` and via sudo otherwise; `sudoers on` becomes "install, then record the
  manifest" and keeps working from a terminal. `--mas` pins the binary path because
  root's PATH under Authorization has no Homebrew; the app passes the path it will run,
  so the strings agree byte for byte (the existing comment's rule). `sudoers remove`
  is the same split for `off`.
- `apps/desktop/src-tauri/src/authorization.rs` (new, small, the FFI module): `pub fn
run_as_admin(prompt: &str, program: &Path, args: &[&str]) -> Result<Output, Declined>`
  over `security_framework::authorization` with `kAuthorizationEnvironmentPrompt`;
  `Declined::{Cancelled, Unavailable(String)}` like `localauth.rs`; one
  `#[allow(deprecated)]` with the reason (Apple deprecated the call in 10.7 and ships it
  still; a helper daemon is the alternative and is out of scope). Runs on a thread; the
  panel never blocks.
- `apps/desktop/src-tauri/src/sudoers.rs` (new, plain functions): `install(app)` =
  resolve the CLI base and the mas path → `run_as_admin(PROMPT, cli, ["sudoers",
"install", "--mas", mas])` → on ok run `sudoers on` as the user (finds the file in
  place, records the manifest, no sudo) → `updates::refresh()`. `remove(app)` mirrors
  it. `PROMPT` is the body text, generated from the same facts the rule carries (which
  commands; that updates still ask for Touch ID; that Settings removes it).
- Triggers, no new Tauri command: `native_send` gains `{"sudoers":"on"|"off"}` on
  `updates`; `SetupVerb` gains `SudoersOn | SudoersOff` behind the existing `setup_run`
  so Settings → Machine gets a switch "Updates and awake as admin" with the current
  state from `sudoers status`. The updates `needsRule` rows send the message on `↵`;
  the band reads "needs admin once · ↵ asks for your Mac password"; `c` stops copying a
  command. The awake panel's two sudoers lines become one row that sends the same
  message.
- States in the report: `approval` already carries Pending/Declined for the sheet;
  reuse it for the dialog with its own `detail` ("admin rule not installed: cancelled").
- Copy: `scuttler sudoers on` leaves every user-facing string in the app, the README
  and the release notes; SETUP.md keeps it as the CLI route with one line saying the app
  does the same from a row.

Alternatives, rejected: a privileged helper via `SMAppService` (resident root process,
XPC in Rust, approval that lands in System Settings; heavier and worse UX than one
dialog writing one file); spawning `osascript` from the app (works, but the header
names osascript, not scuttler); NOPASSWD for everything (hands root to any process
running as the user with no sheet at all, never).

## Steps

- [x] Spike in-process: a `#[ignore]` test in `authorization.rs` that runs `/usr/bin/id
-u` under the dialog; confirm the header names scuttler (from the built app, since
      a `cargo test` binary is not the bundle) and the body is ours; record what the
      dialog shows in this file.
- [x] `packages/setup`: `sudoers install --mas <path>` and `sudoers remove`, root-direct
      when `EUID == 0`; `on`/`off` compose them; tests cover the root path (fixture sudo
      must not be called), the `--mas` pin, and that `on` still works from a terminal.
      `doctor` unchanged.
- [x] `authorization.rs` with `Declined`, the cancel code (`errAuthorizationCanceled`,
      -60006) mapped to `Cancelled`, non-zero exit of the child to `Unavailable(tail)`.
- [x] `sudoers.rs`: `install`/`remove`/`status`, the prompt text, the manifest step as
      the user, `updates::refresh()` after; unit tests for the argv and the prompt.
- [x] `native_send` `{"sudoers":"on"|"off"}`; `SetupVerb::SudoersOn|SudoersOff` and the
      Machine tab switch (state from `sudoers status`, busy while the dialog is up).
- [x] Updates model/panel: `needsRule` rows send the message on `↵`; band and sub copy;
      `rowCommand` no longer returns a command for them; stories and `model.test.ts`.
- [x] Awake panel: the two sudoers lines now point at Settings → Machine (the panel is
      keyboard-driven and has no button primitive; a row that sends is a later call).
- [x] Docs: DECISIONS entry; AGENTS invariants 1 and 13 (third sheet); SETUP.md; README;
      JOURNAL if the dialog teaches anything; STATUS; this plan to `done/` with the
      live-run notes, same commit.
- [ ] Live, Mitch at the Mac: from a fresh state (`scuttler sudoers off` first), press
      `↵` on the App Store row → dialog → password → row reads ready; Settings switch
      off → dialog → row reads "needs admin once"; cancel on the dialog → band says so,
      nothing written.

## Acceptance criteria

- [ ] No user-facing string in the app, README or release notes tells anyone to run
      `scuttler sudoers on`.
- [ ] From the updates panel with no rule: `↵` on the App Store row shows the system
      admin dialog headed by scuttler; password → the rule is written, visudo-valid,
      identical to what `scuttler sudoers on` writes (same hash in the manifest); the
      row reads ready without a restart.
- [ ] Cancel on the dialog: nothing written, the band says not approved, the panel
      keeps focus discipline (invariant 6).
- [ ] Settings → Machine switch reflects `sudoers status`, turns the rule on and off
      through the same dialog, and works with the Machine rung off (the CLI lives in
      the bundle; the rung gates its shell/defaults, not this).
- [ ] `scuttler sudoers on|off|status` from a terminal behave as before.
- [ ] The app still runs only `sudo -n` (grep stays true); the root step is the CLI
      under Authorization, once.
- [ ] `pnpm verify` green; zsh tests cover `install`/`remove`; Rust tests cover argv,
      prompt, error mapping.
- [ ] Memory: nothing resident (the Authorization ref lives for one dialog); covered by
      the release receipt.

## Out of scope

Touch ID in the admin dialog (not offered by macOS for this right). A privileged
helper. Brew casks that need root (a later addition to the same rule, same dialog once
more). Removing the CLI route.

## Risks / open questions

- `AuthorizationExecuteWithPrivileges` is deprecated. It has shipped in every macOS
  since 10.7 and is what `osascript … with administrator privileges` uses; if Apple
  removes it the fallback is spawning `osascript`, same dialog, worse header. The call
  is isolated in one module for that reason.
- The dialog attributes the request to the process that holds the Authorization ref.
  Under `tauri dev` that may read as the dev binary; the built app is the test.
- `setup::run` may refuse when the Machine rung is off (invariant 12, `boot` returns
  early); the sudoers verbs must not be gated by the rung. Check in step 5.
- Root's PATH: the install step must not `command -v` anything; `--mas` and absolute
  paths only.
