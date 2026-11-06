# Setup: the Machine rung

> The design of `packages/setup` — the `scuttler` CLI shipped inside the app — and the
> source of AGENTS invariant 11: _a path outside our own config has exactly one owner,
> recorded in a manifest; adopt moves, never overwrites._ History: the CLI began as a
> separate "distro" repo (DECISIONS 2026-08-25, 2026-08-28) and folded into this one on
> 2026-09-11 (DECISIONS; `plans/done/2026-09-11-unify-into-scuttler.md`). Nothing in it
> runs unless the Machine rung is on (`machine.enabled`, off by default; invariant 12).

## The idea in one paragraph

The Machine rung is **a read-only base shipped in the app bundle**, **a CLI that renders
base ⊕ overlay into the paths other tools already read**, and **a manifest that remembers
every file it touched**. Opinions good enough to defend in a README are in the base;
everything else is overlay. The manifest is what makes it a system instead of a script:
`doctor` can say what drifted, and `remove` can leave.

## What's on disk

```
<app bundle>/Contents/Resources/setup/   the base — read-only, versioned with the app
  bin/scuttler                          the CLI (zsh 5.9, nothing else; DEVIATIONS.md)
  lib/                                   core, manifest, snapshot, defaults, files, doctor,
                                         link, migrations, shell, remove, sudoers
  defaults/                              macOS defaults, one file per concern, idempotent
  shell/                                 zshrc loader + NN-*.zsh (env, path, prompt, completion,
                                         aliases, tools, terminal title, plugins)
  prompt/p10k.zsh  terminal/{ghostty,tmux.conf}  git/scuttler.gitconfig
  migrations/                            YYYY-MM-DD-slug.zsh, run once each by `migrate`

~/.config/scuttler/                     the overlay — the only place you write
  defaults.sh                            defaults flipped back or added (last declaration wins)
  zsh/*.zsh                              sourced after the base, in sorted order
  ghostty, tmux.conf                     fragments appended to the rendered configs
  (config.json, scripts/, plugins/, widgets/, themes/ are the app's; same directory, not setup's)

~/.local/state/scuttler/                state — what doctor and remove need; never hand-edited
  manifest                               every owned path + its mode (below)
  defaults.before                        value (or absence) of every key the base wrote, pre-apply
  adopted/                               originals moved aside, tree-shaped (adopted/.zshrc, …)
  touched/                               a copy of each file we appended a stanza to, before
  migrations                             which have run
  current/theme/, theme.name             the app's rendered theme (THEMES.md) — imported by every
                                         generated file; not setup's to write
```

Under `tauri dev` the base is the source tree, `packages/setup/` (`setup.rs` finds
either). Themes and templates are **not** here: `packages/theme` renders the current theme
into `current/theme/`, and the generated shell files import from that path.

## Where it writes, and how it owns what it writes

The CLI targets the **standard** locations — `~/.zshrc`, `~/.p10k.zsh`,
`~/.config/ghostty/config`, `~/.config/tmux/tmux.conf`, `~/.config/git/`, macOS
`defaults`, `~/.local/bin` — so every other tool keeps working with no knowledge of
scuttler. Each owned path has exactly one mode, recorded in the manifest:

| Mode               | For                                                                                                    | doctor / remove                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **symlink → base** | `~/.local/bin/scuttler` (`link`)                                                                       | Checks the link target; remove unlinks                      |
| **generated**      | `.zshrc`, `.p10k.zsh`, Ghostty, tmux, `scuttler.gitconfig` — rendered from base ⊕ overlay              | Re-renders and diffs (hash in the manifest); remove deletes |
| **adopted**        | A file that existed before scuttler wrote the same path                                                | Parked in `state/adopted/`; remove puts it back             |
| **touched**        | A file that stays yours but carries one marker-bounded stanza of ours (`~/.config/git/config` include) | Hashes the block; remove strips it                          |
| **root**           | The one root-owned file: `/etc/sudoers.d/scuttler` (`sudoers on`)                                      | Hash recorded (0444); remove sudo-deletes                   |

Manifest line shape (one per path, tab-separated):

```
<mode>\t<path>\t<source-or-render-hash>\t<layer>
```

Adopt **moves, never overwrites**: a foreign file at a path we are about to write goes to
`state/adopted/<path relative to $HOME>` first. Two mechanics make the rule true rather
than aspirational: the defaults snapshot (`defaults.before`) is taken before the first
write of each key and never updated afterwards, and nothing is ever overwritten in place.

One rule, this user, no password, naming exactly:
`pmset -a disablesleep 1` and `0`, so the app's `awake` can switch macOS sleep off while
a hold is armed (DECISIONS 2026-10-01); and the `mas` on PATH with `upgrade`/`update`,
so the updates panel can upgrade App Store apps — mas 7 requires root — after the
system approval sheet (Touch ID, Apple Watch or password; DECISIONS 2026-11-06). The app
only ever runs `sudo -n`: without the rule it asks nothing, awake holds on power
assertions alone and the App Store row says it needs admin once. The rule goes in from
the app — `↵` on that row, or Settings → Machine → "allow admin" — through the system
admin dialog, one Mac password (DECISIONS 2026-11-07); or from a terminal, `scuttler
sudoers on`. Install mas after the rule and allow again: the rule names the binary's
path. `off`, or "remove the rule", takes it out through the same dialog.

## The verbs

Every verb is a walk over the manifest; every writing verb has a plan form that is the
default, and `--apply` only ever follows a plan (`--yes` skips the one question).

| Verb                 | What happens                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`             | Read-only. Defaults in check mode (drift per key), the shell files re-rendered and diffed, every manifest entry verified (link intact? hash equal? original still parked?). Exit 1 on any drift.                                                                                                                        |
| `defaults [--apply]` | Plan: every `defaults` key the base ⊕ overlay declares, current → new. Apply: snapshot each unseen key, write, read back, restart the apps that cache them (Dock, Finder, SystemUIServer).                                                                                                                              |
| `shell [--apply]`    | Plan: the generated files above, diffed. Apply: adopt what's there, write, record; clone the zsh plugins (p10k, autosuggestions, syntax-highlighting, history-substring-search, completions) under `~/.local/share/zsh/plugins`.                                                                                        |
| `link` / `unlink`    | Put `scuttler` on PATH at `~/.local/bin/scuttler` (a symlink into the bundle; adopts anything foreign at that path), or take it off.                                                                                                                                                                                    |
| `migrate`            | Run every base migration this machine has not yet run, in date order; the app runs this at startup when the rung is on (`setup::boot`). Format and rules: `packages/setup/migrations/README.md`.                                                                                                                        |
| `sudoers on \| off`  | The root-owned rule above; one password. `install`/`remove` are its root halves, run by the app as root under the admin dialog, then `on`/`off` as the user for the manifest.                                                                                                                                           |
| `remove`             | The manifest in reverse: links unlinked, generated files deleted (noting any you edited since), adopted originals restored, touched stanzas stripped, the sudoers file removed; `defaults.before` restored (keys that had no value deleted); then the CLI's own records. Leaves the overlay — it's yours — and the app. |
| `version`, `help`    |                                                                                                                                                                                                                                                                                                                         |

Settings → Machine drives `doctor`, `defaults`, `shell`, `link`, `migrate` and
`sudoers` through `setup.rs` with the same arguments (`--apply --yes` after you have
seen the plan in the window; `sudoers` through the admin dialog); `remove` is
terminal-only by design.

## The install, as the user sees it

```sh
curl -fsSL https://www.scuttler.app/install | sh
```

That is the **app's** install (`install/install.sh`): preflight (Apple Silicon, macOS
14+, Xcode CLT, Homebrew), `brew install --cask mitchmalone/tap/scuttler`, open the app.
It changes no defaults and touches no dotfiles. The Machine rung is a toggle in Settings
afterwards; turning it on shows the defaults plan and asks once. Fresh Mac or existing one,
same path; the difference is how many adopt lines the plan prints.

## Reversal, honestly

Cleanly reversed by `remove`: every file it wrote, every adopted original, every macOS
default it changed (to the value found, or deleted if there was none), the PATH link, the
sudoers rule, the git include stanza. The overlay is untouched.

Left behind, and said so: Homebrew and the app itself (`brew uninstall --cask scuttler`
is the app's uninstall, README), the zsh plugin clones under `~/.local/share/zsh/plugins`,
permission grants and the login item (macOS won't let us revoke; the app's own), Dock and
WindowManager keys (restored, but visibly revert only after logout).

## And dotfiles?

The author's private chezmoi repo is a fleet config (Macs, Pis, cloud). On a Mac it
writes exactly one scuttler thing: `~/.config/scuttler/` — the overlay. Fleet identity,
ssh, git identity, Linux hosts, backups stay there. The shell base lives in this repo's
`packages/setup/shell/`; Linux hosts can pull that directory in via a chezmoi external so
they keep the shared shell without a copy.

Split by **audience**, not by machine:

| What                          | Where                                   | Who    |
| ----------------------------- | --------------------------------------- | ------ |
| good-for-anyone Mac opinions  | the base (`packages/setup`)             | public |
| only-you Mac residue          | `~/.config/scuttler/` (chezmoi-managed) | you    |
| fleet: hosts, identity, Linux | dotfiles repo                           | you    |

## The one rule

**A path is owned by exactly one thing, and the manifest says which.** That is what lets
`doctor` say what drifted and `remove` actually leave — and it applies beyond this
package: the app's `aerospace.toml`, borders, hook entries, theme renders and editor
themes follow the same adopt-or-leave (invariant 11).

## Not built, on purpose

- `install` and `update` as CLI verbs: the curl installer installs the app, and the app's
  own update (`updates ⏎`, Homebrew) is the base's update — a new app is a new base.
- A Brewfile, Caps→Hyper, `duti` default-app overrides, a `desktop/` layer: the first
  distro's plan. The desktop is the app's Desktop rung (`desktop.rs`, with its own
  adopt-or-leave); the rest returns only on demand.
