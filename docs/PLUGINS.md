# scuttlarr plugins

A plugin is a **directory** in `~/.config/scuttlarr/plugins/<id>/` that owns a cell in
the bar, a panel in the launcher, or a background service — or all three. Its logic runs
in a Bun process; its UI is React on the scuttlarr kit. Drop the directory in and it's
live: no build step of your own, no restart. The reference plugin is
[`apps/desktop/plugins/hello/`](../apps/desktop/plugins/hello/) — copy it to start.
Bundled plugins (`packages/plugins/`: `usage`, `calendar`, `updates`) are written to the same
contract, so what scuttlarr ships is what you get (DECISIONS 2026-08-27).

```
~/.config/scuttlarr/plugins/hello/
  manifest.json    who it is and what it contributes
  service.ts       optional · the logic, under Bun, out of the webview
  cell.tsx         optional · the bar cell, React on @scuttlarr/tui
  panel.tsx        optional · the `hello ⏎` panel, same
```

**Two runtimes, one rule each.** Everything that touches the world — clocks, files,
shell-outs, credentials, the network — lives in `service.ts`. Everything a person sees
lives in `cell.tsx` / `panel.tsx`, built only from kit components, so a plugin looks
native in every theme and renders identically on scuttlarr.com. The UI never calls
Tauri; it gets a four-call `host` and nothing else.

## `manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "hello",
  "name": "Hello",
  "version": "0.1.0",
  "description": "one line for the settings list",
  "kinds": ["bar-widget", "panel"],
  "zone": "right",
  "icon": "hand",
  "panel": {
    "title": "Hello",
    "hint": "the reference plugin ▸",
    "triggers": ["hi"]
  },
  "settings": [
    { "key": "HELLO_NAME", "label": "Name", "hint": "who to greet" }
  ],
  "requires": [
    {
      "label": "GitHub CLI, signed in",
      "fix": "brew install gh && gh auth login"
    }
  ],
  "auth": { "label": "Sign in with GitHub" }
}
```

- `id` — `[a-z0-9-_]`, ≤ 32 chars. Names the directory, the layout slot (`plugin:<id>`),
  the trigger file (`triggers/plugin.<id>`), and the panel word (`hello ⏎`). A user
  plugin can't shadow a bundled id.
- `kinds` — what the plugin contributes: `bar-widget` (a cell), `panel` (an `id ⏎`
  panel), `service` (background only). Drives where it appears; the files decide what
  renders.
- `zone` — where the cell first lands (`left` | `center` | `right`); move it in
  Settings → Menubar afterwards like any module.
- `icon` — a [lucide](https://lucide.dev/icons) name: the generic cell's glyph, the
  panel row's icon.
- `interval` — seconds; **present = tick mode** (below). Absent = stream mode.
- `timeout` — seconds a tick may run (default 10, max 60).
- `panel` — `title`, `hint` (dim row copy), extra `triggers`, fuzzy `aliases`.
- `settings`, `requires`, `auth` — what the plugin needs from the user; defined under
  **Settings and sign-in** below. Settings are collected in Settings → Menubar → Plugins
  and delivered as **env**; secrets go to the Keychain; `auth` means `service.ts auth`
  runs the plugin's own sign-in.
- `permissions` — privacy classes the service touches: `bluetooth`, `camera`,
  `microphone`, `location`, `contacts`, `calendars`, `reminders`, `photos`,
  `local-network`. Shown under the plugin in Settings with what macOS currently says;
  before the service runs scuttlarr **asks** for any it has not decided (one prompt, in
  scuttlarr's name, at a predictable moment) and **does not run it** while one is denied
  — the row says so and offers the Privacy pane. An unknown name fails the manifest.

## `service.ts` — the logic

Run under Bun (`runtime.rs`; any executable named `service` works too), from the plugin's
directory, with the declared settings as env and `SCUTTLARR_PLUGIN=<id>`.

**Stream mode** (no `interval`): scuttlarr keeps the process alive. Every line on stdout
is one JSON value and becomes the plugin's **state**; the bar and the panel re-render on
each. Lines on **stdin** are messages from the UI (`host.send(...)`), plus
`{"poke":true}` when `~/.config/scuttlarr/triggers/plugin.<id>` is touched. If the
process exits it is restarted with backoff (1 s doubling to 60 s; reset after a minute
alive); the cell keeps the last state and shows the error.

**Tick mode** (`interval` set): `service.ts tick` runs every N seconds (min 5) with a
timeout; stdout is one JSON state. A tick-mode plugin with no `cell.tsx` whose state is a
`WidgetView` (below) renders through the generic cell and card — that is all a
single-file widget ([WIDGETS.md](WIDGETS.md)) is.

stderr goes to scuttlarr's log (`Console.app`, `[plugin <id>]`) and its tail lands on the
cell when the service dies. A line over 1 MiB is dropped as an error.

### `WidgetView` — the generic cell and card

A tick's JSON state, when there is no `cell.tsx` (type: `@scuttlarr/tui/bar/types`):

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

Every field is optional; `{}` is a valid blank cell.

- `icon` — lucide name for this tick (falls back to the manifest icon).
- `label` — short text beside the glyph: a count or a percentage; details belong in the card.
- `tone` — `ok` (plain fg) · `warn` · `error` (theme danger) · `muted` · `accent`.
- `click` — `{"type":"open","value":…}` (URL/file/app via `open`), `{"type":"copy","value":…}`,
  `{"type":"none"}` — the scripts action vocabulary.
- `card` — `title`, dim `subtitle`, `rows` (each: `dot` tone, `text`, dim right-aligned
  `hint`, optional `action`), dim `hint` at the bottom.
- `setup` — `{ "message": "no GitHub credentials — sign in with the GitHub CLI", "fix": "gh auth login" }`:
  the plugin can't run until the user acts. A **dim** cell (nothing broke), the message in
  the card and the settings row, the fix as a copyable command. Use this for a missing or
  stale credential — never `hidden`, which hides the problem and the fix (Mitch, 2026-08-20).
- `hidden: true` — no cell this tick, for a plugin with genuinely nothing to say.

## Settings and sign-in

**Piggyback first:** the best credential is one the user already has — the provider CLI's
own login (`gh auth token`, the Vercel CLI's store), which the CLI keeps fresh. Declare it
in `requires`, and when it's missing or stale answer with `setup` (above) so the user is
told and handed the fix. Declared **settings** are the override for users without the CLI:
scuttlarr collects them in Settings and hands them to the service as **environment
variables**. The plugin never touches a store (DECISIONS 2026-08-19;
`plans/done/widget-settings.md`).

```json
"settings": [
  { "key": "VERCEL_TOKEN", "label": "Vercel", "hint": "a token from vercel.com/account/tokens", "secret": true, "required": true }
],
"requires": [{ "label": "GitHub CLI, signed in", "fix": "brew install gh && gh auth login" }],
"auth": { "label": "Sign in with GitHub" }
```

- `key` — the env-var name (`[A-Z][A-Z0-9_]*`, ≤ 40). `label`/`hint` are the field copy.
- `secret: true` — stored in the **macOS Keychain** (service `scuttlarr`, account
  `widget/<id>/<KEY>`), masked in the UI, never sent to the settings webview or written to
  `config.json`. Plain settings live in `config.json` (`widgets.<id>.<KEY>` for widgets,
  the plugin's block for plugins) — edit either place.
- `required: true` — until it's set the service is **not run**: the cell is a dim glyph,
  the card and the settings row say `needs setup: <KEYS>`. Optional settings arrive unset.
- Up to 16 settings. Defaults in the file beat fields in the UI.
- `requires` — static prerequisites, shown under the plugin in Settings with the fix
  copyable, so the expectation is visible before anything fails.
- `auth` — the plugin owns an OAuth / device flow: scuttlarr runs `service.ts auth` (same
  env as a tick; up to 15 minutes; **cancel** kills it) and reads **one JSON object per
  stdout line**: `{"url": …, "code": …}` (shown with an **open** button),
  `{"message": …}` (progress, dim; a non-JSON line counts as a message),
  `{"settings": {"GITHUB_TOKEN": "gho_…"}}` (stored; only keys declared `secret` may be
  set this way). Exit 0 = signed in and tick now; non-zero = the stderr tail is the error.
  When a token expires the plugin answers `setup`, not `error`. The GitHub device flow in
  `apps/desktop/widgets/github-actions.ts` is the worked example, dormant until a
  scuttlarr OAuth App client id exists.

## `cell.tsx` and `panel.tsx` — the UI

Default-export a React component. Import from `@scuttlarr/tui` (components, hooks, the
bar cells and cards), `@scuttlarr/tui/plugins` (types), `lucide-react`, and `react` (a
plugin written before the fold may still import `@launcharr/tui`; the alias resolves) —
the app provides its own single instance of each (a plugin directory has no
`node_modules`; these resolve at load time), so a second React or a second kit never
loads. Anything else you import must be vendored into the plugin directory, and is
bundled. No CSS files, no `style` tags, no `invoke`: components and theme tokens are the
styling, the `host` is the reach.

```tsx
import { BarCard, BarCardTitle, BarHoverCell, ICON_PROPS } from '@scuttlarr/tui'
import type { PluginCellProps } from '@scuttlarr/tui/plugins'
import { Hand } from 'lucide-react'

export default function HelloCell({ plugin, state, hover, host }: PluginCellProps<MyState>) { … }
```

Props (`@scuttlarr/tui/plugins`):

| prop       | cell | panel | what                                                               |
| ---------- | ---- | ----- | ------------------------------------------------------------------ |
| `plugin`   | ✓    | ✓     | the `PluginState` — id, name, health, `error`, `builtAt`           |
| `state`    | ✓    | ✓     | the service's latest state (your shape), `null` before the first   |
| `settings` | ✓    | ✓     | plain settings as the user set them (`{ HELLO_NAME: 'Mitch' }`)    |
| `now`      | ✓    |       | the bar's 1 Hz clock                                               |
| `hover`    | ✓    |       | the hover feed for a `BarHoverCell` card; absent where none exists |
| `host`     | ✓    | ✓     | `open(url)` · `copy(text)` · `send(message)` · `openPanel(id?)`    |
| `onClose`  |      | ✓     | close the panel (Esc)                                              |

Use `BarHoverCell` with `id={`plugin:${plugin.id}`}` for a cell with a card (cards anchor
to their zone's edge automatically, so they stay on screen wherever the cell sits); the kit's
`Panel`, `ListRow`, `KeyHints`, `Calendar`, `MeterRow`… for panels. A card can hold
controls too — wrap them in `BarCardControls` and `Toggle`, `Slider`, `ListRow`,
`SegmentedControl` render as they do in a panel (the author's `lights` plugin, outside
this repo, does this: a row per light, sliders under it). A component that
throws paints its own cell red (the message is in the card and in Settings) and nothing
else in the bar changes.

**Building.** scuttlarr runs `bun build` on the UI files when a plugin is installed and
whenever a file in its directory changes, into `~/.config/scuttlarr/.build/<id>/`, and
hot-swaps the module — edit `cell.tsx`, watch the strip. A build error shows on the cell
and in Settings. Bun is required for UI files (Node has no TSX); a plugin without UI
files runs under either.

## Install, manage, debug

- **Install:** Settings → Menubar → Plugins → paste a git URL (one `git clone --depth 1`,
  on click, never in the background), or `git clone` into
  `~/.config/scuttlarr/plugins/` yourself — the watcher picks it up.
- **Off/on:** the checkbox in Settings (`config.plugins.disabled`). A disabled plugin's
  service is stopped, its cell and panel vanish.
- **Restart:** Settings → restart, or `r` in `plugins ⏎`: service respawned, tick run
  now, UI rebuilt.
- **`plugins ⏎`** — the gallery: every plugin's live cell in a strip, health, `⏎` to open
  its panel. Where to look while writing one.
- **Refresh on demand:** `touch ~/.config/scuttlarr/triggers/plugin.<id>`.
- **Logs:** `Console.app` → scuttlarr → `[plugin <id>]` (stderr) and
  `[scuttlarr plugins]` (supervisor).

## Reference plugins

- **`apps/desktop/plugins/hello/`** — stream service, cell with a card, panel, `host.send`.
  Copy it to start.
- **`apps/desktop/plugins/mirror/`** — tick service, no UI of its own (hidden while
  healthy, red with a card when a sync fails). Every 5 minutes it rsyncs another
  machine's Codex and Claude Code journals over your own ssh into
  `~/.local/share/scuttlarr/mirrors/<host>/{codex,claude}/`, which the usage monitor
  scans by convention alongside the local journals — so `usage ⏎` counts every machine.
  Settings: `MIRROR_HOST` (an ssh alias that works with `BatchMode=yes`). Anything else
  that puts `*.jsonl` under that path counts too (Syncthing, a cron).

## Bundled plugins

`packages/plugins/` holds the plugins scuttlarr ships — `usage` (the agent usage cell +
`usage ⏎`), `calendar` (`cal ⏎`), and `updates` (app updates across brew, the App Store,
pnpm and mise — a count in the bar, `updates ⏎` for the list; its `updates` provider
re-checks each source every 5–30 min (an errored one in 5), `touch triggers/plugin.updates` or `r` in the panel for now; `↵` or a
click on a package row upgrades that package in the panel with live output, a source's
"Upgrade all" row the whole source, `a` everything — jobs queue and run one at a time, `x`
cancels; `t` hands the selected row to your terminal instead, for a cask that wants sudo;
`d` dismisses a package for a day — out of the count and of every bulk upgrade, dim under
its manager, `↵` restores). Same contract, two differences: their UI is
Vite-bundled with the app, and their state comes from a Rust provider named in the
manifest (`"native": "usage"`) instead of a Bun service, so the app never depends on Bun
for its own panels. `native` is refused in user plugins. scuttlarr.com imports these
same files for its demo (invariant 10) — a bundled plugin that can't render from a
fixture isn't finished.

## Rules of the road

- **State is data, UI is code.** Put opinion in the cell; put the world in the service.
- **Kit only.** If the kit lacks a component you need, that's a kit change — a plugin
  reaching for raw HTML and CSS is the thing this design exists to avoid.
- **Network is your business,** and it says so in Settings through `requires`/`settings`.
  Be fail-visible and cache: a plugin that blocks or blanks when a host is down is a bug.
- **Hardware is a helper, not a native module.** A plugin directory has no `node_modules`
  and Bun does not load node-gyp addons, so a service that needs a radio or a device
  spawns a small compiled helper (Swift + CoreBluetooth, JSON lines on stdio, built once
  into a dotdir the watcher ignores) and keeps the protocol in TypeScript where it is
  testable. Worked example: the author's `amaran` light plugin, outside this repo
  (JOURNAL 2026-09-10).
- **Declare what you touch.** macOS attributes a helper's privacy access to scuttlarr.app
  and kills it, no prompt, when the bundle lacks the usage string. The bundle ships a
  string for every class in `permissions` (DECISIONS 2026-09-10 ×2) and `permissions.rs`
  asks and checks before the service runs — but only for what the manifest declares. An
  undeclared class still works (the string is there) and simply prompts on first use; a
  class not in the list needs its string added to `src-tauri/Info.plist` first.
- **Trust.** Installing a plugin runs its code, like an editor extension. Read what you
  install.
