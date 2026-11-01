# @scuttlarr/setup

The Machine rung's CLI, shipped inside the app bundle under `Contents/Resources/setup/`
and driven from Settings → Machine (`setup.rs`): `bin/scuttlarr`, `lib/` (core, manifest,
snapshot, defaults, files, doctor, link, migrations, shell, remove, sudoers), `defaults/`
(one file per concern, idempotent), the shell base (`shell/`, `prompt/`, `terminal/`,
`git/`), `migrations/`, hermetic zsh tests under `test/`. Design: `docs/SETUP.md`.
Deliberately zsh 5.9 with no runtime — it must run with nothing but macOS present
(`DEVIATIONS.md`). Folded in from the distro repo on 2026-09-11 (DECISIONS).

```sh
packages/setup/bin/scuttlarr doctor        # read-only: what differs from base ⊕ overlay
packages/setup/bin/scuttlarr defaults      # plan every macOS default that would change
pnpm --filter @scuttlarr/setup test        # syntax floor + tests, also part of pnpm verify
```

`scuttlarr link` (or Settings → Machine) puts the bundled CLI on PATH at
`~/.local/bin/scuttlarr`; `scuttlarr help` lists every verb.
