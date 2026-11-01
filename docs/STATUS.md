# STATUS

> The cursor: where we are, what needs hands, what's next. A snapshot, not a history —
> history lives in git, `plans/done/`, `releases/` and `JOURNAL.md`; the backlog with its
> triggers lives in `ROADMAP.md`.
>
> Last updated: 2026-11-01 (the rename to scuttler is coded and verified; v0.8.1 is one
> `release.sh` run away, after the GitHub repo rename — Mitch's hands)

## Where we are

- **Released: v0.8.0** (2026-11-01, `releases/v0.8.0.md`): first-launch setup, the
  updates ledger with in-app upgrades and dismissals, agent dots, defaults flipped (bar
  on, tiling off), the site in any app theme. Fan-out green; the next release is one
  command (`scripts/release.sh X.Y.Z`, smoke tests scripted).
- **Docs sweep done** (`plans/done/2026-11-01-docs-sweep.md`, six commits): the memory
  receipt, STATUS/ROADMAP/PRD as cursors, SETUP.md true, STANDARDS re-vendored, the
  extension docs split, the logs re-sorted and marked, the site on the kit's own panel
  registry, bar layout and launcher.
- **The rename is in the tree** (`plans/active/2026-11-01-rename-to-scuttler.md`,
  DECISIONS 2026-11-01): scuttlarr → scuttler everywhere but history, bundle id kept,
  `rename.rs` second hop with the state symlink, frecency and config name rewrites, the
  Keychain/plugin/CLI/site fallbacks, the setup migration, `releases/v0.8.1.md` drafted.
  `pnpm verify` green. **Not yet done:** the release itself (phase 3) and the brand
  assets (phase 4) — see Needs Mitch.
- **Parked:** `plans/done/lights-plugin.md` (built, in daily use; Nanoleaf waits on
  Mitch's Home.app shortcuts, outside the repo); `plans/active/opensource-readiness-review.md`
  (`planned`, rewritten for the current scope; ROADMAP carries its trigger).
- **Daily use on the primary Mac:** bar, launcher, panels, agents, usage, updates, awake,
  the Desktop and Theme rungs (`appearance.everywhere`, `editors`, `ghostty` on).
- **Memory:** one measurement, the receipt (DECISIONS 2026-11-01, `scripts/mem.sh
--receipt`). The open task, growth with uptime, is ROADMAP "Memory".
- **Workbench story titles are stable** (an external screenshot script keys on them):
  rename a story only with Mitch.

## Needs Mitch (decisions)

- `opensource-readiness-review`: run before the first public announcement, or not.
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

Release path (phase 3 of the rename plan). Done 2026-11-01: GitHub repo renamed to
`mitchmalone/scuttler` (origin updated); Vercel project `scuttler` serves `www.scuttler.app`
from `ab2174a`; the Notion backlog and product-home pages renamed; this Mac dev-installed
over the live 0.8.0 profile (config, state, share, `scuttler.db`, hook paths and the login
item migrated; state symlink in place since the Machine rung is off; `sudoers status`
reports the pre-rename rule); receipt 113 MB and cold start 151 ms in `releases/v0.8.1.md`.
**Blocked on one thing:** `scripts/release.sh 0.8.1` refuses because the notary profile
`launcharr-notary` is not in this Mac's keychain (v0.8.0 was notarised on the Mac mini).
Store it once — `xcrun notarytool store-credentials launcharr-notary --apple-id <id>
--team-id HXRC74AQZR` — then the release is one command, and after it: fan-out green, the
tap holding `scuttler.rb` plus a deprecated `scuttlarr.rb`, and the live proof of the one
cross-rename upgrade (a 0.8.0 install runs `updates ⏎` → `↵`, lands as `scuttler.app`;
`brew upgrade` on a scuttlarr install reports the deprecation).

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

Release v0.8.1 (phase 3 above), close the rename plan in the release commit, then
whatever ROADMAP's triggers fire. The v0.8.0 memory receipt baseline is taken at the
release build, before the new one replaces it.
