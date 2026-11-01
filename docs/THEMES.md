# Themes

One palette, rendered into every surface. Decided 2026-09-11 (DECISIONS: theme format;
theme policy). Built in `packages/theme` (the model: parsing, derivation, templates,
tokens — its README is the API reference), `packages/core/src/appearance.ts` (the
policy), and `apps/desktop/src-tauri/src/{theme,appearance,theme_editors,user_themes}.rs`
(apply, inputs, the editor retints, your themes). This file is the user-facing truth:
what a theme is, where it lands, and which one is active when.

## A theme is one file

`packages/theme/themes/<name>/colors.toml`, in [Omarchy](https://omarchy.org)'s format with
the keys unchanged, so any Omarchy theme ports by copying the file:

```toml
mode = "dark"                 # or "light"; absent → decided from background luminance

accent = "#bd93f9"
selection = "#44475a"
muted = "#6272a4"

background = "#282a36"        # dark_/darker_/lighter_background derive if absent
foreground = "#f8f8f2"        # dark_/light_/bright_foreground likewise

red = "#ff5555"  yellow = "#f1fa8c"  orange = "#ffb86c"  green = "#50fa7b"
cyan = "#8be9fd" blue = "#bd93f9"    magenta = "#ff79c6" brown = "#a0522d"
# bright_* derive (mix with white, 20%) if absent

[launcher]                    # optional: pin any of the app's thirteen UI tokens
sigil = "#50fa7b"
selected = "rgba(68, 71, 90, 0.55)"
```

Derivation (mixes, aliases, `colorN` ↔ names, mode from luminance) is Omarchy's, step
for step. The app's thirteen tokens (`bg`, `surface`, `glass`, `border`, `fg`, `dim`,
`accent`, `sigil`, `bang`, `selected`, `warn`, `danger`, `good`) map from the palette by
rule, and `[launcher]` overrides any of them verbatim. The rules, the token table, the
template syntax and how the built-in token modules are generated and stale-checked are in
`packages/theme/README.md`; adding a theme is the four steps there.

## Surfaces

Templates live in `packages/theme/templates/` (one per surface, token substitution
only, no logic; `templates/README.md` lists them). Rendered files land in
`~/.local/state/scuttlarr/current/theme/<file>`; a theme directory may ship a hand-written
file with the same output name and the renderer leaves it alone.

| Surface         | Rendered file       | How it takes effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App windows     | —                   | tokens, live (always on)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| JankyBorders    | —                   | flags re-rendered from tokens, live (Desktop rung)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ghostty         | `ghostty`           | `config-file = ?~/.local/state/scuttlarr/current/theme/ghostty` — new windows; open windows retint by OSC (below); with `appearance.ghostty` a running Ghostty 1.3+ re-reads its config over AppleScript (`perform action "reload_config" on first terminal`, one Automation consent) so open windows take the whole file                                                                                                                                                                                                                                                                                                                                                                                         |
| tmux            | `tmux.conf`         | `source-file -q …/current/theme/tmux.conf`; running panes retint at once via OSC 10/11/12/17/19/4 + SIGWINCH — as does **every other open shell**: the OSC goes into every `/dev/ttysNNN` the user owns (Ghostty outside tmux, Terminal.app, anything), no permission needed                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Prompt (p10k)   | `p10k-colors.zsh`   | `source …/current/theme/p10k-colors.zsh` before segment colours — next prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| delta           | `delta.gitconfig`   | git `[include] path = …/current/theme/delta.gitconfig` — next invocation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Claude Code     | `claude.json`       | written to `~/.claude/themes/scuttlarr.json`; pick `custom:scuttlarr` once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| macOS           | —                   | light/dark via System Events when the policy owns the mode (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| VS Code, Cursor | `vscode-theme.json` | `appearance.editors`: installed as local extension `~/.vscode/extensions/scuttlarr.theme-0.0.1/` (and `~/.cursor/…`), registered in `extensions.json`; `"workbench.colorTheme": "scuttlarr"` set in `settings.json` (`.bak-scuttlarr` once). Hot: settings edit applies live (`workbenchThemeService` listens to the setting); a rewritten theme file reloads live because the contribution carries `_watch: true` (`colorThemeData.ts`: `watch = theme._watch === true`); the _first_ install lands live only via the `extensions.json` watcher (`extensionsWatcher.ts` → `_handleDeltaExtensions`) — if a window doesn't pick it up, it's right on the next launch. `uiTheme` (vs/vs-dark) is read on load only |
| Zed             | `zed-theme.json`    | `appearance.editors`: `~/.config/zed/themes/scuttlarr.json` + `"theme": "scuttlarr"` in `settings.json` (object form: light and dark halves; `.bak-scuttlarr` once). Hot: Zed watches the themes dir (`watch_themes` in `crates/zed/src/main.rs` → `load_user_theme` → `reload_theme`) and its settings file                                                                                                                                                                                                                                                                                                                                                                                                      |
| Neovim          | `neovim.lua`        | LazyVim spec naming `neovim_colorscheme` (per-theme defaults in `packages/theme/src/editors.ts`, `colors.toml` overrides) — `dofile()` it from your lazy specs. Hot with `appearance.editors`: every server under `$TMPDIR/nvim.<user>/*/nvim.<pid>.0` (`:h $XDG_RUNTIME_DIR`, `stdpath("run")`) gets `<Cmd>set background=…<CR><Cmd>colorscheme …<CR>` over `nvim --server … --remote-send` (`:h --remote-send`). The scheme must be installed in that Neovim                                                                                                                                                                                                                                                    |
| Helix           | —                   | `appearance.editors`: `theme = "<helix_theme>"` rewritten in `~/.config/helix/config.toml` (root line, `.bak-scuttlarr` once), then `pkill -USR1 -x hx` — Helix documents USR1 as config reload (docs.helix-editor.com/configuration). Hot                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| btop            | `btop.theme`        | `appearance.editors`: `~/.config/btop/themes/scuttlarr.theme` + `color_theme = "scuttlarr"` in `btop.conf` (`.bak-scuttlarr` once), then `pkill -USR2 -x btop` — `src/btop.cpp`: `SIGUSR2 → Global::reload_conf = true`. Hot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Anything else   | —                   | `~/.config/scuttlarr/hooks/theme-set.d/*` runs with the theme name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`scuttlarr shell --apply` writes the Ghostty, tmux, p10k and git include lines for you —
they are part of the generated base configs (SETUP.md); Claude Code's `custom:scuttlarr`
is still a one-time pick. `theme set` never edits those configs.

## Apply

TypeScript renders (pure); Rust makes it true (`theme.rs`): every file is staged under
`~/.local/state/scuttlarr/current/next-theme/`, the old `current/theme/` is removed, the
stage is renamed into place — one atomic move, no half-written theme — and `theme.name`
is written beside it. Then the reloads fan out, each independent and fail-visible: a
surface that fails is named in Settings, never swallowed.

Turn it on: Settings → General ▸ Theme → **Everywhere**, then **apply now**. From then on
a change of theme re-renders and reloads. Off, only the app windows and borders theme.
**Also reload Ghostty's config** asks a running Ghostty to re-read its config over
AppleScript, so open windows take the whole template rather than the OSC's colours only
(one Automation consent, first time; nothing is launched if Ghostty isn't running).
**Also retint editors** adds VS Code, Cursor, Zed, Neovim, Helix and btop: each gets a
generated theme installed and its own settings file switched (one `.bak-scuttlarr`
beside it), and running instances change on the spot. The Machine rung's
`scuttlarr shell --apply` writes the configs that import from the state path, so
nothing is left to hand-edit.

## Policy: which theme, and when

`@scuttlarr/core/appearance`, pure; stored flat in `config.appearance`:

| Key        | Meaning                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `mode`     | `system` (follow macOS, its sunrise/sunset included), `light`, `dark`, or `schedule`                  |
| `schedule` | `{ light: "07:00", dark: "19:00" }` — our own clock, for people with the macOS feature off            |
| `pair`     | `{ light, dark }` theme names                                                                         |
| `focus`    | macOS Focus id → a theme (both modes) or its own `{ light, dark }` pair                               |
| `macos`    | flip macOS light/dark with the theme — only when `mode` ≠ `system`, or the two would chase each other |

Resolution: a mapping for the active Focus wins, else the pair; the mode picks the half.
Rust reports the inputs with no permission (`appearance.rs` watches
`~/Library/DoNotDisturb/DB/` for the active Focus and `~/Library/Preferences/` for
`AppleInterfaceStyle`); the panel window resolves on every input, policy edit, or schedule
boundary and writes `config.theme` only when the answer changes. A manual pick —
Settings, or `theme ⏎` — writes the slot the policy is reading, so it sticks.

The engine is **opt-in**: inert until `config.appearance` exists, and the pair is seeded
with your current theme on both halves, so turning it on changes nothing until you choose
a light or a dark theme (JOURNAL 2026-09-11).

**Switching by hand.** `theme ⏎` lists every theme with a swatch; ⏎ applies and sticks,
⌥⏎ sets the row as the _other_ half (pick tonight's dark theme while it is still light).
For a global hotkey, bind a custom shortcut to the row "scuttlarr — Theme switcher"
(Settings → General ▸ Shortcuts; Omarchy's is ⌥⌃⇧Space). "Toggle Dark Mode" flips the
policy's mode when it is `light`, `dark` or `schedule`, and flips macOS when it is
`system` — either way the theme follows.

## Your themes

- `~/.config/scuttlarr/themes/<name>/colors.toml` — a new theme, or a same-named
  replacement for a built-in (one file is the whole theme). Hand files beside it
  (`ghostty`, `tmux.conf`, `neovim.lua`, …) win over the template. Paid themes (Dracula
  Pro) live here and never in the repo. The directory is watched: save the file and every
  window's picker knows. Settings → General ▸ Theme → "Your themes" lists them and
  installs one from a git URL (`omarchy-<name>-theme` naming; a cloned theme contributes
  only `colors.toml` and known hand files — never symlinks or scripts); "update
  installed" pulls them.
- `backgrounds/*.{jpg,png,heic,webp}` in a theme directory — wallpapers. Each apply
  advances to the next one; the row "scuttlarr — Next wallpaper" cycles by hand.
  Built-ins ship none (images don't belong in the repo).
- `"themes": { "<name>": { "accent": "#…" } }` in config.json — token-only overrides;
  they style the app windows and nothing else, because there is no palette to render
  from.

## Rules

- **Themes are data.** A theme is a palette; rendering is the package's job.
- **Light is first-class.** `solarized-light` ships so no template can assume dark;
  `mode` drives `color-scheme`, macOS appearance, and the bar's alert tones.
- **Never redistribute what we don't have the licence for.**
- **Nothing reloads by signal without a documented handler** — an unhandled signal kills
  the process. Ghostty's `SIGUSR2` reload is Linux-only (JOURNAL 2026-09-11); on macOS
  every open shell retints by OSC, new windows read the file, and the AppleScript reload
  is an opt-in.
