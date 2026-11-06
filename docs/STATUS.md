# STATUS

> The cursor: where we are, what needs hands, what's next. A snapshot, not a history —
> history lives in git, `plans/done/`, `releases/` and `JOURNAL.md`; the backlog with its
> triggers lives in `ROADMAP.md`.
>
> Last updated: 2026-11-06 (v0.8.5 released, fan-out green; the shell stays Tauri, DECISIONS 2026-11-06;
> agent state will come from the screen, planned; cells no longer stick on "working" after Claude's away recap,
> JOURNAL 2026-11-06; the bar is one push stream with cheaper snapshots and
> no per-frame paint, DECISIONS 2026-11-05; the 20-hour instance was found at 4 GB and
> is now watched with `mem.sh --webkit`, JOURNAL 2026-11-05; next: the shell spike)

## Where we are

- **Released: v0.8.5** (2026-11-06, `releases/v0.8.5.md`): the rename, the fast bar,
  the agents fix; receipt 113.5 MB, cold start 179 ms. Fan-out green (check, homebrew,
  notion, deploy-mmcom); the tap holds `scuttler.rb` 0.8.5 with `auto_updates` and
  `scuttlarr.rb` deprecated to it; `www.scuttler.app` and `/install` serve 0.8.5. Both plans closed
  (`plans/done/2026-11-01-rename-to-scuttler.md`,
  `plans/done/2026-11-04-v0.8.5-fast-bar-and-shell-spike.md`); the shell stays Tauri
  (DECISIONS 2026-11-06). Previous: v0.8.0 (2026-11-01).
- **Docs sweep done** (`plans/done/2026-11-01-docs-sweep.md`, six commits): the memory
  receipt, STATUS/ROADMAP/PRD as cursors, SETUP.md true, STANDARDS re-vendored, the
  extension docs split, the logs re-sorted and marked, the site on the kit's own panel
  registry, bar layout and launcher.
- **In flight: make agent statuses correct**
  (`plans/active/2026-11-06-make-agent-statuses-correct.md`, DECISIONS 2026-11-06):
  built 2026-11-06 — a rule engine over 22 bundled per-agent rule files (herdr's
  catalogue shapes), screens read from tmux for working/attention panes and on every
  hook event, agent panes discovered without a hook, the Claude hook reduced to a
  hint; dev-installed, watching it on Mitch's panes before the next release.
- **Parked:** `plans/done/lights-plugin.md` (built, in daily use; Nanoleaf waits on
  Mitch's Home.app shortcuts, outside the repo); `plans/active/opensource-readiness-review.md`
  (`planned`, rewritten for the current scope; ROADMAP carries its trigger).
- **Daily use on the primary Mac:** bar, launcher, panels, agents, usage, updates, awake,
  the Desktop and Theme rungs (`appearance.everywhere`, `editors`, `ghostty` on).
- **Memory:** one measurement, the receipt (DECISIONS 2026-11-01, `scripts/mem.sh
--receipt`), and the floor beside it (`--webkit`: WebKit's helpers by responsible pid,
  and the app's owned-but-unmapped share, which is the leak's gauge). Growth with
  uptime is ROADMAP "Memory", now with a number.
- **Workbench story titles are stable** (an external screenshot script keys on them):
  rename a story only with Mitch.

## Needs Mitch (decisions)

- The 22 rule files under `apps/desktop/src-tauri/agents/` carry herdr's catalogue
  shapes (herdr.dev/agent-detection, no licence text on those files; the binary is
  Apache-2.0). Ask herdr, credit them in the README, or rewrite the files from our own
  captures over time: your call before the next release ships them.
- Whether the receipt should now count WebKit's helpers (`mem.sh --webkit` can see
  them: ~140 MB of WebContent and GPU at idle on top of the 41 MB app). The budget
  line in AGENTS says 120 MB for the app alone; a floor that honest would need a new
  number.
- A day after 2026-11-05's install, run `scripts/mem.sh --webkit` on the launchd
  instance: if "owned but unmapped" is above single-digit MB the leak is still live and
  the spike's bare-WKWebView arm should test for it first.

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

Agent state from the screen (the plan is written). Then the memory leak's gauge after
a day of uptime, and the ROADMAP's open items by trigger.
