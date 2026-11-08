# STATUS

> The cursor: where we are, what needs hands, what's next. A snapshot, not a history —
> history lives in git, `plans/done/`, `releases/` and `JOURNAL.md`; the backlog with its
> triggers lives in `ROADMAP.md`.
>
> Last updated: 2026-11-08 (the open-source readiness review is done:
> `reviews/2026-11-08-opensource-readiness.md`, five blockers, the first of them a local
> privilege escalation through the App Store sudoers rule; pnpm upgrades fixed to reach
> `latest`; the admin-rule branch waits on the review's B1 and B3 before it merges)

## Where we are

- **Remediation under way** (`plans/active/2026-11-08-readiness-remediation.md`): B5
  done (rustls 0.23.46, webpki-roots 1.0.11, `next ^16.4.5`; both audits clean), B2 done
  (`renderTheme` validates every palette value, cloned themes ship only data hand
  files, DECISIONS 2026-11-08), `dependabot.yml` added. B1 and B3 are next, on the
  admin-rule branch; B4 is Mitch's settings.
- **Reviewed 2026-11-08: open-source readiness** (`reviews/2026-11-08-opensource-readiness.md`,
  plan `plans/done/2026-11-08-opensource-readiness-review.md`). Five read-only reviews
  over the whole repo at one commit. Blockers before announcing: **B1** the NOPASSWD
  rule names `/opt/homebrew/bin/mas`, a user-owned file, so anything running as the
  user is root without a password (shipped in v0.8.6 via `scuttler sudoers on`); **B2**
  an installed theme's palette values run unescaped in p10k, git and Neovim
  (reproduced); **B3** the unmerged admin dialog runs the user-owned zsh CLI as root
  under the user's environment; **B4** main and tags unprotected, a bot with write,
  secret scanning and Dependabot off; **B5** `next 16.3.0` and `rustls` advisories
  (routine bumps). Then a pre-announcement list (CSP and plugin UI reach, self-update
  hardening, pipeline pins, setup CLI fixes, SECURITY.md, licences, code health) and
  the proposed residual-risk list for Mitch to accept. Remediation is the next plan.
- **In flight: the admin rule installs from the app** (branch
  `feat/admin-rule-from-the-app`, worktree `../scuttler-admin-rule`, dev-installed):
  Settings → Machine and the updates panel write the rule behind the macOS admin
  dialog. Built and verified, the live run not yet done; holds until B1 and B3 above
  are fixed on the branch.
- **Fixed 2026-11-08: pnpm upgrades reach `latest`** (`pnpm update -g --latest`; a 0.x
  caret in the global manifest pinned codex at 0.163 while the row promised 0.167,
  JOURNAL 2026-11-08). Verified live: codex 0.167.0.
- **Released: v0.8.6** (2026-11-06, `releases/v0.8.6.md`): receipt 114.4 MB, cold start
  198 ms; fan-out green (check, homebrew, notion, deploy-mmcom); the tap holds
  `scuttler.rb` 0.8.6. Three pieces of work from two sessions: root upgrades in the
  panel (`plans/done/2026-11-06-admin-updates-in-panel.md`), agent statuses from the
  pane's screen (`plans/done/2026-11-06-make-agent-statuses-correct.md`) and quicklinks
  by name (DECISIONS 2026-11-06); the second session's commits were on main before the
  first branched, so one release carried all three (JOURNAL 2026-11-07).
- **Verified 2026-11-07: the approval sheet works live.** After Mitch killed the wedged
  `SecurityAgent` (`kill -9`; plain `kill` is ignored, like sudo inside PAM),
  `scuttler sudoers on` installed the rule with the mas alias, `sudo -n mas upgrade`
  ran with no prompt, and the LocalAuthentication sheet came up and approved
  (`cargo test --lib localauth -- --ignored`). Plan closed
  (`plans/done/2026-11-06-admin-updates-in-panel.md`). Still to watch, not open work:
  the first real App Store upgrade from the panel (`a` with an app outdated) and the
  decline path; nothing was outdated on 2026-11-07.
- **Previously released: v0.8.5** (2026-11-06, `releases/v0.8.5.md`): the rename, the fast bar,
  the agents fix; receipt 113.5 MB, cold start 179 ms. Fan-out green (check, homebrew,
  notion, deploy-mmcom); the tap holds `scuttler.rb` 0.8.5 with `auto_updates` and
  `scuttlarr.rb` deprecated to it; `www.scuttler.app` and `/install` serve 0.8.5. Both plans closed
  (`plans/done/2026-11-01-rename-to-scuttler.md`,
  `plans/done/2026-11-04-v0.8.5-fast-bar-and-shell-spike.md`); the shell stays Tauri
  (DECISIONS 2026-11-06). Previous: v0.8.0 (2026-11-01).
- **Shipped in v0.8.6: quicklinks fire by name as well as shortcode** (`youtube gcn` searches
  YouTube; bare `youtube ⏎` opens the site root, not the raw template; `you` ⇥ completes to
  `youtube `; DECISIONS 2026-11-06 is the record).
- **Docs sweep done** (`plans/done/2026-11-01-docs-sweep.md`, six commits): the memory
  receipt, STATUS/ROADMAP/PRD as cursors, SETUP.md true, STANDARDS re-vendored, the
  extension docs split, the logs re-sorted and marked, the site on the kit's own panel
  registry, bar layout and launcher.
- **Shipped in v0.8.6: agent statuses come from the pane's screen**
  (`plans/done/2026-11-06-make-agent-statuses-correct.md`, DECISIONS 2026-11-06):
  built 2026-11-06 — a rule engine over 22 bundled per-agent rule files (herdr's
  catalogue shapes), screens read from tmux for working/attention panes and on every
  hook event, agent panes discovered without a hook, the Claude hook reduced to a
  hint; dev-installed and watched on Mitch's panes before the release. The rule
  files are herdr-derived under Apache-2.0: credited in `THIRD-PARTY-LICENSES.md`
  (bundled), the README and each file's header (Mitch's call, 2026-11-06).
- **Parked:** `plans/done/lights-plugin.md` (built, in daily use; Nanoleaf waits on
  Mitch's Home.app shortcuts, outside the repo).
- **Daily use on the primary Mac:** bar, launcher, panels, agents, usage, updates, awake,
  the Desktop and Theme rungs (`appearance.everywhere`, `editors`, `ghostty` on).
- **Memory:** one measurement, the receipt (DECISIONS 2026-11-01, `scripts/mem.sh
--receipt`), and the floor beside it (`--webkit`: WebKit's helpers by responsible pid,
  and the app's owned-but-unmapped share, which is the leak's gauge). Growth with
  uptime is ROADMAP "Memory", now with a number.
- **Workbench story titles are stable** (an external screenshot script keys on them):
  rename a story only with Mitch.

## Needs Mitch (decisions)

- Whether the receipt should now count WebKit's helpers (`mem.sh --webkit` can see
  them: ~140 MB of WebContent and GPU at idle on top of the 41 MB app). The budget
  line in AGENTS says 120 MB for the app alone; a floor that honest would need a new
  number.
- A day after 2026-11-05's install, run `scripts/mem.sh --webkit` on the launchd
  instance: if "owned but unmapped" is above single-digit MB the leak is still live and
  the spike's bare-WKWebView arm should test for it first.

- **Readiness review B1**: which way to close the mas rule (root-owned copy of mas named
  in the rule; per-batch admin dialog instead of NOPASSWD; the SMAppService helper), or
  accept and say plainly that "allow admin" is passwordless root for anything running
  as you. The review recommends the root-owned copy.
- **Readiness review B4**: GitHub settings only Mitch can change: rulesets on `main` and
  `v*` (both repos), `beebeebot` write → triage or behind the rules, secret scanning,
  push protection, Dependabot, private vulnerability reporting.
- **Readiness review section 5**: confirm or strike each proposed residual risk; each
  accepted one becomes a DECISIONS or DEVIATIONS line.
- Usage pace thresholds (±15/25 pts) and worst-across-accounts for the cell.
- Whether "hidden when clean" is right for the updates cell.
- p10k dir colour: follow the theme or the host?
- The `/docs` page is now a map (links to the repo's docs, the panel list and the bar
  default rendered from the kit); say if a fuller page was wanted instead.

## Needs Mitch (hands-checks, v0.8.0)

Updates (dev-installed 2026-10-31; `plans/done/2026-10-31-updates-in-app-upgrades.md`,
`2026-11-01-updates-dismiss.md`):

- Hover the updates cell: the card lists Homebrew's outdated formula with versions.
  `updates ⏎` → click a formula row: "upgrading…", the last output line under the meter,
  then "upgraded"; the re-check drops the count. Band "upgrade all" and head "upgrade
  everything" run on click. A second click while one runs reads "queued", meter `1 of 2`.
- A failing package (`beeper/tap/cli`, the tap's bug) reads "… · Homebrew failed" with
  brew's line under the meter and keeps its failed mark after the re-check. `d` on it:
  count drops, cell hides when nothing else is pending, row dim under Homebrew reading
  "dismissed · 23 h left", head says "· 1 dismissed", "upgrade everything" skips it; `↵`
  brings it back; relaunch keeps the dismissal.

Agent dots (`plans/done/2026-10-28-agent-dots.md`): all tmux agents on the bar after
their next hook event; working ring spins, attention ring breathes in `warn`, done disc,
read check after a jump, idle moon; the card's doing line reads `editing format.ts`;
Reduce Motion stops both animations; amber and terminal themes keep the shapes legible;
the site legend renders the same icons.

First-launch setup (`plans/done/2026-10-19-first-launch-setup.md`,
`2026-10-20-setup-launch-toast.md`): fresh-install path on a clean user account (setup
opens on first launch, applies in under a minute, bar and launcher work without
Settings); `setup ⏎` starts from the current config; the hotkey try; Esc on the theme
screen restores the old theme; the field stops while hidden (idle CPU); with an awake
hold armed, five fresh-config launches each open setup on first summon.

Release path: v0.8.5 released 2026-11-06 from this Mac (notary profile stored); fan-out,
tap and site checked by the agent. Still yours: the live
proof of the one cross-rename upgrade (a 0.8.0 install runs `updates ⏎` → `↵`, lands as
`scuttler.app`; `brew upgrade` on a scuttlarr install reports the deprecation);
`www.scuttler.app/install` and the old domain's redirect; `git grep -i scuttlarr`
outside history and compatibility constants.

Site (docs sweep step 6, not seen in a browser by the agent): home page copy; `/docs`;
the demo prompt is now the kit's `Launcher` (type `setup`, `theme`, `ss`, `usage`; `?`
mode; `!git status`); the bar still, the agent spotlight and the state legend retint with
the theme picker; the install tabs (Script first); the workbench stories and the pixel
hero.

## Needs Mitch (elsewhere)

- Back from travel (JOURNAL 2026-10-19): Rapid Security Responses (`CriticalUpdateInstall`)
  and Tailscale auto-update back on.
- Dotfiles: commit the aerospace.toml triggers change; prune the sketchybar config; the
  shell base's include lines are uncommitted in chezmoi (or the next `apply` fights it).
- lights plugin: create the `lights/<light>/…` shortcuts, then measure `shortcuts run`
  latency and slider drag in a card.
- Rename leftovers that need hands or pixels: `public/og.png` and `public/menubar-icon.png`
  redrawn as scuttler (Claude Design); dotfiles to `~/.config/scuttler/` and the theme
  import path; `custom:scuttler` in Claude Code; `scuttler sudoers on` once; the Notion
  release row's name; the old domain's renewal date goes here once known.

## Next

Main is pushed. In order:

1. **Remediate the readiness review's blockers** (a plan from the report's section 3):
   B1 on the admin-rule branch with B3, then merge and do the live run; B2 in
   `packages/theme` with tests first; B5 as two dependency bumps; B4 is Mitch's
   settings. Then the section 4 list by value.
2. **Make summon measurably fast** (ROADMAP, Product): a Tauri replacement was asked
   for and declined again on the spike's numbers; what the user feels is after the
   0.32 ms show call and has never been measured end to end. Instrument hotkey → first
   painted frame, keystroke → results paint, Enter → hidden; fix what the numbers name
   (a webview WebKit suspends while hidden is the first suspect); numbers into the
   receipts. Open question for Mitch: which of summon, typing, Enter or the bar feels slow.
3. `scripts/mem.sh --webkit` on the launchd instance after a day up (1 h 44 m in, it
   read 5.2 MB owned-but-unmapped: clean so far).
4. Watch the agent cells; a wrong cell is a captured screen (`SCUTTLER_SCREEN=…
cargo test --lib rules::tests::explain -- --ignored --nocapture`) and a rule.
5. Light mode first-class (closes the theme policy gate bug), then the ROADMAP by trigger.
