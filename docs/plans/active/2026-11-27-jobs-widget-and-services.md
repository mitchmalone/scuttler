---
title: Jobs widget, and widget services with their own configuration screen
status: active
created: 2026-11-27
updated: 2026-11-27
links:
  - Notion: "GitHub Actions monitor becomes a generalized job monitor" (Fleet / The Backlog)
  - plans/active/2026-11-23-settings-redesign.md
  - fix/actions-widget-all-active (the actions fixes this builds on)
---

# Jobs widget, and widget services with their own configuration screen

## Goal

One bar widget, **jobs** (lucide `activity`), that watches every place Mitch's jobs run:
GitHub Actions, Dagu, Vercel builds. Each is a service the user adds and configures,
and each one gets its own header in the card. It replaces `github-actions.ts` and `vercel.ts`.
The settings for it are a real screen, not fields in a list. Today's flat
`settings` (one env var per key, one value per widget) can't hold "add two Dagu
servers". So the configuration model is generic, and any widget (arr next) can declare services.

## Decisions (Mitch, 2026-11-27)

- Layout **5b** of the mock (`05 Widget services` on the settings-redesign canvas):
  services stacked in one box, collapsible. **Add service** is a button in the
  Services header, right of the count, opening a dropdown of type names only (icon +
  name, no descriptions).
- **Every widget** moves to the configure screen ("rolled out to the config of
  others"): arr's four servers become services; widgets with only plain settings
  (uptime, mirror) get the same screen with their fields. Field lists leave the
  Widgets page, which becomes the inventory (5a).
- Card: every row in every section (Mitch's earlier ask for GitHub); folding is
  not built.

## Context

- Widget contract: `docs/WIDGETS.md`, `widgets.rs` (`WidgetManifest.settings`,
  `resolve_settings`, `settings_for`), values in `config.widgets[id]` (string map),
  secrets in the Keychain via `widget_secrets` (`<id>/<KEY>`).
- Settings UI: `settings/views/WidgetsPage.tsx` lists widgets with their fields inline
  (`widget-kit.tsx` `WidgetSettings`); `settings/pages.ts` is the page registry.
- Dagu: on lilnasx at `https://lilnasx.tailbfcc77.ts.net:8443`, `DAGU_AUTH_MODE=builtin`
  (`wifi/stacks/dagu/compose.yaml`); peekay's jobs moved there 2026-11-27, which is
  why its GitHub workflows are disabled. Docs (docs.dagu.sh): API key as
  `Authorization: Bearer dagu_…` (Admin → API Keys, viewer role is enough);
  `GET /api/v1/dags?perPage=1000` → `dags[].{fileName, dag.name, suspended,
latestDAGRun.{dagRunId, status, statusLabel, startedAt, finishedAt}}`; status
  0 not started, 1 running, 2 failed, 3 aborted, 4 succeeded, 5 queued, 6 partial,
  7 waiting, 8 rejected; run page `/dag-runs/<name>/<dagRunId>`, DAG page
  `/dags/<fileName>/`. Confirmed by the Wifi session against 2.27 (2026-11-27):
  `/api/v1` is the API (401 unauthenticated); `/api/v2` falls through to the SPA
  with a 200, so never trust a 200 there. Real ts.net certificate. CORS blocks a
  webview, fine for a widget child. The community edition allows 2 API keys. peekay-sync
  (every 5 min) is plumbing to hide; youtube-backfill has never run; rss and twitter
  fail daily upstream.

## Approach

**Services in the manifest.** A manifest may declare `services`: the types it knows,
each `{ type, name, icon, settings: WidgetSetting[], requires }`, so a type's fields reuse
today's `WidgetSetting` shape. jobs declares `github` (GITHUB_TOKEN optional secret,
GITHUB_REPOS), `dagu` (DAGU_URL required, DAGU_TOKEN required secret) and `vercel`
(VERCEL_TOKEN optional secret, VERCEL_TEAM_ID).

**Instances in config.** A new top-level `config.widgetServices: { [widgetId]: Service[] }`,
`Service = { id, type, label, values: { KEY: string } }`. Secrets go in the Keychain as
`<widgetId>/<serviceId>/<KEY>`. `config.widgets` stays untouched, so flat settings keep working.
A user can add the same type twice (two Dagu servers, two Vercel teams).

**Delivery.** On each tick the widget gets `SCUTTLER_SERVICES` (env, JSON): the configured
instances with their values and secrets resolved. An instance with a required value
missing isn't delivered. Settings marks it "needs setup", and the widget never sees it
(off means off). No services configured = no requests at all; the card says
"add a service in Settings".

**The widget.** `jobs.ts` holds one source module per type, each reading its own state
into rows: GitHub keeps the per-workflow, active-only, deduped logic from the fix branch;
Dagu shows the latest run per DAG and skips suspended DAGs; Vercel keeps the token fallback and renewal. The card
shows one section per instance, headed by its label. If a source fails, it gets a dim row
in its own section, and the other sources still render. The cell is `activity`, red with
the failing count across all sources, amber while anything runs.

**The configuration screen.** Settings → Widgets gets a "configure" button on each widget that
declares services (or has more than a few settings). It opens a full screen inside the
settings window, with a back button to the list. That screen has the widget's header and
status, then **Services**: one entry per instance (label, type icon, status,
fields, remove), and **Add service**: a picker of the manifest's types. Adding one
creates the instance with a default label ("Dagu", "Dagu 2") and opens its fields.
The generic flat settings render on the same screen, so later widgets can graduate to
it without a new screen per widget.

**IPC.** No new command if it can be helped. `widget_secret_set` and `widget_secret_keys`
take an optional `service` id (a new field on existing commands); instance lists and plain
values are written with the existing config `set`. Recorded in DECISIONS as a
contract change, not an IPC addition.

**Migration.** On first load: the bar layout's `widget:github-actions` / `widget:vercel`
become one `widget:jobs`. The github-actions `GITHUB_REPOS` value and any Keychain
`GITHUB_TOKEN` / `VERCEL_TOKEN` become a GitHub and a Vercel service instance. The
installed `github-actions.ts` and `vercel.ts` stay where they are (user files; adopt,
never delete). Settings offers to remove them once jobs is running.

Alternative rejected: a jobs-only settings page. It solves this widget and leaves arr
(four services already, flat `*_URL` keys) and every later widget on the flat list
that's already running out.

## Steps

- [x] Look: mock `05 Widget services` on the settings-redesign canvas; Mitch picked 5b,
      Add service in the Services header, type names only, every row
- [x] Contract: `services` in `WidgetManifest` (Rust + `@scuttler/tui`), validation,
      `config.widgetServices`, `SCUTTLER_SERVICES` with complete services only; tests
- [x] Secrets keyed per service; `widget_secret_set` / `_keys` take `service`; DECISIONS
- [x] `jobs.ts`: github, dagu, vercel sources, sectioned view; `jobs.test.ts`
- [x] Settings: configure screen for every widget, add/remove/rename service, fields,
      status; Widgets page is the inventory
- [x] arr: its four apps are services; `appSettings` reads them
- [x] Migrations (config load, once the widget file is installed): github-actions and
      vercel slots and repos to jobs; arr URLs to services; arr keys copied forward
      from the old Keychain items on first read; tests
- [x] Remove `github-actions.ts` and `vercel.ts`; WIDGETS.md, PLUGINS.md, DECISIONS
- [ ] Live checklist on an installed build (below)
- [ ] Mitch creates a Dagu viewer API key (REST only) and pastes it; the first real call
      confirms `fileName` (with or without `.yaml`)

### Live checklist

- [ ] Copy `jobs.ts` and the new `arr.ts` into `~/.config/scuttler/widgets/`; relaunch
- [ ] Bar: one `activity` cell where GitHub Actions sat; the Vercel slot is gone
- [ ] Settings → Widgets: GitHub Actions and Vercel say "replaced by Jobs"; remove them
- [ ] Jobs → configure: GitHub Actions (pinned repos carried over) and Vercel services
- [ ] Add service → Dagu; URL and key pasted; the card gets a Dagu section with rss and
      twitter red and peekay-sync hidden once listed in Hide
- [ ] Media stack → configure: four services, each "ready" (keys copied forward), card
      unchanged
- [ ] Remove a service: its section leaves the card on the next tick

## Acceptance criteria

- [ ] Mitch adds a Dagu service (URL + API key) in Settings and the card shows its DAGs
      under a "Dagu" header, next to GitHub Actions and Vercel sections
- [ ] A service with missing required fields makes no request and says so in Settings
- [ ] One source failing leaves the other sections rendered
- [ ] Existing GitHub repos and tokens carry over without re-entry
- [ ] `pnpm verify` green; no new resident process (widgets already tick as children),
      so the release receipt covers memory

## Out of scope

- Plugins' settings (they share widget-kit; they can adopt the screen later)
- Failure alerts or notifications beyond the cell going red
- Acting on jobs (re-run, cancel) from the card

## Risks / open questions

- `config.widgetServices` is a new config key: old builds ignore it, so a downgrade
  loses only the jobs widget's services, not other settings.
- The configuration screen is the first drill-down in the settings window; search
  (`SEARCH_INDEX`) should reach it.
