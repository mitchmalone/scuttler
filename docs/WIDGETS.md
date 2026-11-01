# scuttler widgets

> **A widget is the single-file form of a plugin.** A plugin (`docs/PLUGINS.md`) is a
> directory that may add its own `cell.tsx` / `panel.tsx`; a widget is one `.ts` file
> answering the same tick contract, rendered by the generic cell and card. Start here for
> a glyph and a card; move to `PLUGINS.md` when the card isn't enough. The field
> reference (`WidgetView`, `settings`, `requires`, `auth`) lives in PLUGINS.md and is not
> repeated here. **Direction:** `widgets.rs` folds into `plugins.rs` as the first-party
> panels move to plugins (ROADMAP "Plugins slice G"); the file format stays, this doc
> then becomes a section of PLUGINS.md.

Widgets are the bar's scripts: drop a **TypeScript file** into
`~/.config/scuttler/widgets/` and it owns a cell in the menubar — a glyph, an optional
short label, a tone, a click, and a hover card of rows. No build, no shebang, no chmod,
no restart: `.ts` runs under **Bun** (or Node when Bun is absent — DECISIONS 2026-08-19).
Any other executable in any language works too. The reference widgets in
`apps/desktop/widgets/` (`uptime.ts`, `github-actions.ts`, `vercel.ts`, `trmnl.ts`) are
yours to copy and edit; the shape is deliberately the same as `docs/SCRIPTS.md`.

```ts
// ~/.config/scuttler/widgets/hello.ts
import type { WidgetView } from '@scuttler/tui/bar/types'

// erased at run time

if (process.argv[2] === 'manifest') {
  console.log(
    JSON.stringify({ id: 'hello', name: 'Hello', interval: 60, icon: 'smile' }),
  )
} else {
  const view: WidgetView = {
    icon: 'smile',
    tone: 'ok',
    card: { title: 'Hello', rows: [] },
  }
  console.log(JSON.stringify(view))
}
```

**Widgets are data, never code.** A widget prints JSON; scuttler renders it with one
generic cell and card, in the theme, on every display. Nothing a widget says can put
markup or script in the bar — which is also why the same widget renders identically on
www.scuttler.app's demo.

## The contract

Any `.ts`/`.js` file (run under Bun/Node) or executable that answers two invocations:

### `<widget> manifest`

Print a JSON manifest to stdout and exit 0:

```json
{
  "id": "uptime",
  "name": "Uptime",
  "interval": 300,
  "zone": "right",
  "icon": "arrow-big-up",
  "timeout": 15
}
```

- `id` — `[a-z0-9-_]`, ≤ 32 chars. Names the layout slot (`widget:<id>`) and the trigger
  file. First registration wins on collision (alphabetical by filename).
- `name` — the card title until a tick sends one. Defaults to `id`.
- `interval` — seconds between ticks. Default 60, minimum 5.
- `zone` — `left` | `center` | `right`; where the cell first appears (default `right`).
  Move it in Settings → Menubar afterwards like any module.
- `icon` — a [lucide](https://lucide.dev/icons) icon name (kebab-case), shown until the
  first tick. Default `puzzle`.
- `timeout` — seconds a tick may run before it is killed. Default 10, maximum 60.
- `settings` — what the widget needs from the user; see **Settings and sign-in** below.
- `requires` — `[{ "label": "GitHub CLI, signed in", "fix": "brew install gh && gh auth login" }]`:
  static prerequisites, shown under the widget in Settings with the fix copyable — the
  expectation is visible before anything fails.
- `auth` — `{ "label": "Sign in with GitHub" }`: the widget answers `auth` (below).

### `<widget> tick`

Called every `interval` seconds (and on demand, below). Print the cell + card and exit 0:

```json
{
  "icon": "arrow-big-down",
  "label": "2",
  "tone": "error",
  "click": { "type": "open", "value": "https://status.example.com/" },
  "card": {
    "title": "Uptime",
    "subtitle": "2 of 9 down",
    "rows": [
      {
        "dot": "ok",
        "text": "mitchmalone.com",
        "hint": "238 ms",
        "action": { "type": "open", "value": "https://mitchmalone.com" }
      },
      { "dot": "error", "text": "psyke.co", "hint": "down" }
    ],
    "hint": "click a site to open it"
  }
}
```

Every field is optional; `{}` is a valid blank cell. The fields — `icon`, `label`,
`tone`, `click`, `card`, `setup`, `hidden` — are the `WidgetView` defined in
[PLUGINS.md](PLUGINS.md) ("`WidgetView` — the generic cell and card").

## Settings and sign-in

`settings`, `requires` and `auth` are defined in [PLUGINS.md](PLUGINS.md) ("Settings and
sign-in") and mean the same here: declared settings are collected in **Settings → Menubar
→ Custom widgets** and arrive as environment variables on every `tick`; secrets go to the
Keychain; piggyback on the provider CLI's own login first and answer `setup` when it is
missing. `vercel.ts` reads `VERCEL_TOKEN`, else the Vercel CLI's store;
`github-actions.ts` carries the device-flow `auth` example.

## Refresh, failure, and the rules of the road

- **On demand:** `touch ~/.config/scuttler/triggers/widget.<id>` ticks a widget now —
  wire it to a git hook, a cron, a keybinding, anything.
- **Live:** the dir is watched. Drop a widget in and its cell appears within a second;
  edit it and it re-ticks; delete it and the cell goes.
- **Fail-visible:** timeout, non-zero exit, or unparseable stdout keeps the last good view
  but turns the cell `error`; the card shows the reason (`exit 1: <stderr tail>` /
  `timed out after 15s` / `bad tick output`) and when it last worked. Nothing ever blanks
  silently. Debug by running `<widget> tick` by hand.
- **Off the hot path:** ticks run on their own thread and are stateless child processes —
  nothing resident between ticks, nothing on the 1 Hz push.
- **Network is the widget's business.** What your widget fetches, and with which
  credential, is yours (DECISIONS 2026-08-15). Credentials come
  from declared **settings** (above) or wherever you like (env, the CLI's own store,
  `secret`); scuttler stores only what a manifest declares, and never calls a provider.
- **Layout:** the widget appears in `bar.layout` as `widget:<id>`; toggle or move it in
  Settings → Menubar. Removed widgets keep their slot in the layout, so a re-install lands
  where you left it.
- **Runtime:** Bun is found on PATH, Homebrew, or `~/.bun`; Node on PATH, Homebrew,
  Volta/fnm/nvm. Neither → the cell reads `needs bun — brew install oven-sh/bun/bun`.
  Guard your entry point with `if (import.meta.main)` so the file also imports cleanly
  into a test (the reference widgets do; their `view()` halves are under Vitest).

## Installing, arranging, removing

- **Settings → Menubar → Custom widgets** (its own sub-tab) lists what's installed with its health ("ok ·
  2m ago", "error · exit 1: …", "hidden"), and offers **install from URL** (one download,
  on click — the file must answer `manifest` or it's discarded with the reason), **add
  file…**, **tick** (run now), **remove** (deletes the file), and **open folder**.
- The **zone board** above it shows custom widgets beside the built-ins as soon as they
  exist — drag them between zones, ✕ retires one to the tray.
- Or skip the UI: `cp`/`ln -s`/`curl -o` into the folder, `rm` to remove — the dir is
  watched either way.

## Reference widgets

| Widget              | Source                          | Cadence | Notes                                                                                                                                                                                         |
| ------------------- | ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uptime.ts`         | Upptime `summary.json`          | 5 min   | Arrow up/down, down-count label, a row per site (opens it). Set `UPTIME_SUMMARY_URL`.                                                                                                         |
| `github-actions.ts` | GitHub API, latest run per repo | 2 min   | `gh auth token` (the CLI keeps it fresh) or a pasted token; your 10 most recently pushed repos (pin a list in the file); failing count, opens the run; dim + `gh auth login` when signed out. |
| `vercel.ts`         | Vercel API `/v9/projects`       | 2 min   | The Vercel CLI's own login or a pasted `VERCEL_TOKEN` (Keychain); latest production deployment per project; dim + the fix when signed out or stale.                                           |
| `trmnl.ts`          | TRMNL `/api/devices`            | 5 min   | Key via `TRMNL_API_KEY` or `secret shared/trmnl/api_key`; hidden without one.                                                                                                                 |

Install one: `cp apps/desktop/widgets/uptime.ts ~/.config/scuttler/widgets/` (or
Settings → Menubar → Custom widgets → add file) — then it's yours to edit in place.
