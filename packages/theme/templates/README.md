# templates

One file per surface, rendered by `@scuttlarr/theme` (`renderTheme`, `../README.md`)
into `~/.local/state/scuttlarr/current/theme/<name without .tpl>`. Token substitution
only, no logic; the syntax and the extra keys (`name`, `mode`, `bat_theme`, the editor
names from `src/editors.ts`) are in the package README. How each rendered file reaches
its program — include lines, live retint by OSC into every tty the user owns, the editor
hot-reload paths — is `docs/THEMES.md` "Surfaces"; `scuttlarr shell --apply` writes the
include lines (`docs/SETUP.md`).

| Template                | Output              | Consumer                                          |
| ----------------------- | ------------------- | ------------------------------------------------- |
| `ghostty.tpl`           | `ghostty`           | Ghostty `config-file = ?…`                        |
| `tmux.conf.tpl`         | `tmux.conf`         | tmux `source-file -q …`                           |
| `p10k-colors.zsh.tpl`   | `p10k-colors.zsh`   | sourced by the lean `.p10k.zsh`                   |
| `delta.gitconfig.tpl`   | `delta.gitconfig`   | git `[include]`                                   |
| `claude.json.tpl`       | `claude.json`       | copied to `~/.claude/themes/scuttlarr.json`       |
| `vscode-theme.json.tpl` | `vscode-theme.json` | VS Code / Cursor local extension (`editors`)      |
| `zed-theme.json.tpl`    | `zed-theme.json`    | `~/.config/zed/themes/scuttlarr.json` (`editors`) |
| `neovim.lua.tpl`        | `neovim.lua`        | LazyVim spec (`editors`)                          |
| `btop.theme.tpl`        | `btop.theme`        | `~/.config/btop/themes/` (`editors`)              |

Helix has no template: its config names a theme, so the app rewrites one line. A theme
directory may ship a hand-written file with the same output name; the renderer leaves it
alone (Omarchy's rule).
