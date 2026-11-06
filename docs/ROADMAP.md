# ROADMAP

> What we build next, and why not yet. Three lists: shipped (one line per release, the
> notes hold the rest), open items with the trigger that starts each, and the non-goals.
> What's happening now is `STATUS.md`; how a task gets built is `plans/`; scope truth is
> `PRD.md`; the reasoning behind every entry here is in `DECISIONS.md` by date.

## Shipped

| Release                                | What it was                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 launcher (2026-08-08, as launcharr) | M0–M4: non-activating panel with exact focus restore, index + fuzzy + frecency, `!` bang mode to iTerm2, terminal-prompt identity, login item. Then v1.1 scripts and Sol parity.                                                                                                                                       |
| v0.2.0 (2026-08-09)                    | Release core: system commands, ⌥⏎ secondary actions, opt-in bookmarks, emoji picker, settings window, release pipeline. `releases/v0.2.0.md`                                                                                                                                                                           |
| v0.3.0 / v0.3.1 (2026-08-12/13)        | Settings as a native surface, fourteen themes, signed and notarized. `releases/v0.3.0.md`, `v0.3.1.md`                                                                                                                                                                                                                 |
| v0.4.0 (2026-08-17)                    | The control surface: bar, TUI kit and workbench, panels (wifi, dns, audio, clipboard, awake, aerospace, help, screenshots), agent cells, wrapped AeroSpace desktop layer.                                                                                                                                              |
| v0.5.0 (2026-08-19)                    | Multi-display (bar per screen, launcher on the mouse's screen), glyph-only bar strip, awake timer card. `releases/v0.5.0.md`                                                                                                                                                                                           |
| v0.6.0 (2026-08-27)                    | Widgets (TypeScript files in `~/.config/scuttler/widgets/`), then plugins as code (`cell.tsx`, `panel.tsx`, Bun services); usage and calendar as plugins. `releases/v0.6.0.md`                                                                                                                                         |
| v0.7.0 (2026-10-01)                    | The fold: launcharr + the scuttlarr distro → one product. Rungs: Desktop, Theme (Omarchy `colors.toml`, policy, live retint), Machine (the setup CLI). Ghostty hand-off. awake.                                                                                                                                        |
| v0.8.0 (2026-11-01)                    | First-launch setup, the updates ledger (in-app upgrades, queue, dismiss), agent dots, defaults flipped (bar on, tiling off), the site in any app theme, scripted release.                                                                                                                                              |
| v0.8.5 (2026-11-06)                    | The rename: scuttlarr → scuttler at `www.scuttler.app`, bundle id kept (`plans/done/2026-11-01-rename-to-scuttler.md`); the bar keeps up with workspaces, one push stream, cheaper snapshots, the lighter-shell spike and its gate (`plans/done/2026-11-04-v0.8.5-fast-bar-and-shell-spike.md`). v0.8.1 was never cut. |

## Open, with triggers

Not started until its trigger fires. "Touch" means the next plan that changes that
surface absorbs the item.

### Memory (the receipt is DECISIONS 2026-11-01)

| Item                                                                                                                                                                                                | Trigger                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Growth with uptime: 41 MB fresh, **4036 MB after 20 h** on 2026-11-05 — owned-but-unmapped shared buffers with the bar's WebContent (JOURNAL 2026-11-05); churn cut in v0.8.5, leak itself unpinned | `mem.sh --webkit` on a day-old instance reads more than single-digit MB unmapped; the spike's bare-WKWebView arm tests for it first |
| The receipt with the bar on by default (v0.8.0 read 114 MB on a light config)                                                                                                                       | A release receipt over 120 MB fails that release                                                                                    |
| Plugin services: lazy-load panels, measure each service's Bun cost in Settings                                                                                                                      | The daily footprint's helper share passes the app's own                                                                             |
| Borders (JankyBorders, 268–460 MB on the primary Mac) — third-party, Desktop rung off                                                                                                               | Only if a lighter border tool appears; otherwise a documented cost of the rung                                                      |

### Bugs known, not chased

| Item                                                                                                                                                                                                                      | Trigger                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Theme policy gate never holds: `config.appearance` is a plain struct so the webview always sees it; a fresh install in light mode flips to `solarized-light` (JOURNAL 2026-10-19; `it.fails` test in `lib/theme.test.ts`) | Light mode first-class, or the next `config.rs` touch |
| Hotkeys bound to built-in `scuttler — …` rows do nothing (empty `path`; link `browser` ignored on that path)                                                                                                              | Touch of `indexer.rs` / custom shortcuts              |
| 23 zombie children in a long-lived instance (JOURNAL 2026-08-26); amaran status replies arriving in one run of four                                                                                                       | Either recurs visibly                                 |

### Product

| Item                                                                                                                                                                                                                                                                                                                             | Trigger                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Light mode first-class** (unify step 3.7): Solarized Light and Catppuccin Latte checked on every surface; nothing assumes dark                                                                                                                                                                                                 | First light-theme complaint, or the policy-gate bug above                   |
| **Plugins slice G**: awake, agents, wifi, audio, battery panels move to `packages/plugins/`; `widgets.rs` folds into `plugins.rs` (WIDGETS.md absorbed into PLUGINS.md first)                                                                                                                                                    | Touch of any of those panels; the fold when the last one moves              |
| **Make agent statuses correct** (built 2026-11-06, in flight: 22 rule files, screen-read states; `plans/active/2026-11-06-make-agent-statuses-correct.md`, DECISIONS 2026-11-06)                                                                                                                                                 | Ships next release; watch cells meanwhile                                   |
| **Make summon measurably fast**: instrument hotkey → first painted frame, keystroke → results paint, Enter → hidden; keep the webview warm while hidden; numbers into the receipts (shell replacement rejected twice, DECISIONS 2026-11-06)                                                                                      | Next plan; Mitch's "snappy" ask 2026-11-06                                  |
| Plugin index on the site (curated install-from-URL list); per-plugin stderr in the logbook; the hello plugin's `import.meta.main` guard under Node                                                                                                                                                                               | A third-party plugin exists                                                 |
| Theme gaps: bar theme cell, macOS accent colour, bat beyond `ansi`, plugin clones in the manifest                                                                                                                                                                                                                                | Touch of the Theme rung                                                     |
| Kit: `ListRow` danger tone (updates error rows are plain text)                                                                                                                                                                                                                                                                   | Next kit touch                                                              |
| Panels and bar: `sysinfo`; settings into panels with a drill-down menu (the native window retires — re-decide, 0.4 invested in it); per-workspace app hints as hover; bluetooth glyph; NSWorkspace front-app observer; per-monitor workspaces (aerospace `--monitor`); a screen-parameters observer instead of the 5 s heartbeat | Each on its own demand; the observers when the heartbeat shows in a profile |
| Widgets left: curated index, `widgets ⏎`, custom SVG icons, event-driven (`watch`) widgets, left-zone card anchor; widget OAuth (dormant until an OAuth App client id exists)                                                                                                                                                    | Absorbed by slice G                                                         |
| Richer bangs (`!!` repeat, project-scoped), per-query learned bindings (schema records the query already), script-declared rendering beyond rows                                                                                                                                                                                 | Bang mode or frecency data shows the pattern                                |
| Move matching to Rust                                                                                                                                                                                                                                                                                                            | R2 fires: WKWebView can't hold the 16 ms keystroke budget                   |
| Open-source readiness review (`plans/active/opensource-readiness-review.md`)                                                                                                                                                                                                                                                     | Before the first public announcement                                        |

### Hands-checks owed from earlier releases (a surface's next plan picks up its line)

- Theme: Ghostty windows outside tmux retint on a switch; VS Code and an editor retint
  live; the Claude Code theme reads well; a Focus flip and a macOS appearance toggle
  change the theme within a second; Solarized Light on every surface; `theme ⏎` Esc path.
- awake: tray Quit stays quit; a hold survives `sudo fdesetup authrestart`; an agents hold
  releases within ~1 min of the last agent idling; the "awake resumed" toast.
- Terminal: `!echo hi ⏎` lands as a new tmux window in Ghostty; updates `a` too.
- Agents and usage: both Claude accounts in Settings → Agents; usage limits against
  claude.ai for both; the Codex tile includes the mirror plugin's sessions; cell click /
  `agents ⏎` lands in the right tmux pane; `⌫` dismisses a row.
- Plugins: hello cell + card + `hello ⏎` (`r` resets), `cal ⏎`, Settings → Plugins,
  `plugins ⏎`; custom widgets sub-tab and install from URL.
- Bar and displays: glyph sizes and legibility in every theme; ⌥Space with the mouse on
  the built-in; hover cards on the second bar; unplug/replug; zone board drag, retire and
  restore via the tray, notched vs external, bar off/on survives.
- Launcher and panels: focus restore after `wifi ⏎` → connect → Esc, also over a
  full-screen app; `colorpicker ⏎` both samplers; `lorem` toast; `?` keeps focus across
  turns; wifi `s` scan and secured join; audio slider and device switch; clipboard
  copy-on-Enter dismisses; help filter; Settings → Desktop "use my own config" / "save a
  copy" dialogs; `ss ⏎` → ⌘V into claude.ai and Claude Code.

## Explicitly not doing (non-goals — load-bearing, PRD §3)

File search, snippets, Windows/Linux. Zero permissions for the launcher core (zero
network was retired 2026-09-04 — DECISIONS). Window management arrives _wrapped_
(AeroSpace brings its own Accessibility grant; scuttler itself still requests nothing).
Nothing distro-shaped left the list on 2026-09-11: it is the Machine rung (`SETUP.md`);
light mode is a palette in the Theme rung (`THEMES.md`). Credentialed, networked bar cells
are per plugin, fail-visible, never telemetry. No native alerts, no emoji, no second copy
of the app UI on the site (AGENTS invariants 13, 14, 10).
