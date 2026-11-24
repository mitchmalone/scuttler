---
title: arr widget (Media stack)
status: active # built and verified against a fake stack; the live run is open
created: 2026-11-23
updated: 2026-11-23
links:
  - ../../WIDGETS.md # reference widgets
  - ../../PLUGINS.md # WidgetView, settings
---

# arr widget (Media stack)

## Goal

A reference widget, `apps/desktop/widgets/arr.ts`, for a self-hosted \*arr stack
(Radarr, Sonarr, Prowlarr, Bazarr). The user enters a URL and an API key per app; nothing
else to install.

**v2 (Mitch's addendum, 2026-11-24, supersedes v1 where they conflict):** most of the
time the card answers what's new, what's coming and what's in flight. Issues stay on top
when there are any; the per-app rows with versions are gone (an app only shows as an
issue: down or refusing its key). Sections: issues, in flight (downloads, the running
conversion), recently added (last 5 imports of the past 7 days, Radarr and Sonarr
history `eventType=3`, deduped, `2h · 4K DV`), coming up (next 5 in 14 days from the
calendars; a monitored episode or movie more than a day past its date without a file is a
warning, "aired, not grabbed"), and a footer `5 movies · 2 shows · 2.9 TB free` (library
lists cached 15 minutes). Bazarr's `/badges` count is replaced by `/movies/wanted` and
`/episodes/wanted`, counting only non-forced English gaps. "New" is the last 24 hours:
the host does not tell a widget when its card was opened.

## Context

Built from a spec written by Beebee (2026-11-23) for Mitch's stack on `beebee`. Same form
as `vercel.ts`: an exported `manifest()`, a pure exported view (`toView`), a thin fetch
shell, rendered by the generic cell and card. No Rust, no IPC command, no kit change.

## Approach

One tick fetches every configured app in parallel (5 s a request, 4 at once per app, 15 s
for the whole tick, under the manifest's 20 s), turns each into an `AppSnapshot`, and
`toView` builds the cell and card. Classification of each payload is its own pure,
tested function (`healthIssues`, `queueDownloads`, `diskIssues`, `indexerIssues`,
`pipelineSnapshot`).

Where the build departs from the spec, and why:

- **No `permissions` or `description` in the manifest.** `WidgetManifest` (`widgets.rs`)
  has neither field; only a plugin's `manifest.json` takes `permissions`. A widget that
  declared `local-network` would have it ignored, so scuttler does not ask up front:
  macOS prompts on the first LAN fetch (PLUGINS.md, "Declare what you touch"). Closing
  that means the permission gate reaching widgets, which is ROADMAP "Plugins slice G".
- **Setup copy names "Settings → Widgets"**, where widget settings
  live, and carries no `fix`: `fix` renders as a copyable shell command and there is none.
- **Cache at `~/Library/Caches/scuttler/widgets/arr.json`** (`XDG_CACHE_HOME` wins),
  beside the self-updater's cache, mode 0600. It holds when each app last answered and
  since when a download has waited to import; nothing else, no secrets.
- **Disk space is judged per root folder** (`/rootfolder`, totals from `/diskspace`), not
  per mount: `/diskspace` lists small system mounts that would keep the cell amber.
- **"Import pending for 30 minutes" is timed by the widget.** The queue API carries no
  such time, so the cache records when a record was first seen waiting.
- **Prowlarr indexer names need `/api/v1/indexer`** (`/indexerstatus` has ids only); it
  is fetched only when something is disabled.
- **The 14-row cap keeps the app rows**; the cut falls on issues, then downloads, and
  `+N more` counts those.
- **A bad download is shown once**, in the downloads section with its reason, and still
  counts toward the issue count and tone.
- **Download titles** are the movie or series name (`Severance S02E04`), falling back to
  the release name.
- **A secondary endpoint that fails** (not a 404) is a warning row naming it, rather
  than silence or a whole app marked down.
- **Redirects are refused** (`redirect: 'manual'`): a wrong base path lands on a login
  page, and following one elsewhere would carry the key.
- **The cell never opens the pipeline status file** while an app has a URL.
- **No workbench story.** Reference widgets have none; their views are covered by
  `arr.test.ts`.

## Steps

- [x] `arr.ts`: manifest, pure classification and `toView`, fetch shell, cache
- [x] `arr.test.ts`: the spec's ten fixtures plus each classifier
- [x] `docs/WIDGETS.md` reference table
- [x] Fetch shell run against a throwaway fake stack on loopback (below)
- [x] v2: recently added, coming up, past due, English-only subtitle gaps, footer; app
      rows removed; fixtures for the healthy default, an empty library, a past-due
      episode, a forced-only gap (no warning) and a full English gap (warning)
- [ ] Live acceptance on Mitch's stack (below)

## Acceptance criteria

- [x] `pnpm verify` green
- [x] Against a fake stack on loopback (Bun server, canned payloads): healthy mix, one bad
      key, every key bad (setup), one app hanging + one answering HTML + one refused, and a
      down app carrying its last-ok time all render as designed; the key appears in no
      stdout or stderr; peak 8 concurrent requests across three apps
- [x] Measured (M-series, Bun, 2026-11-23): tick 110 ms against the loopback stack
      (three apps and the status file, 30 ms of server latency a request); a hung app
      costs 5.0 s, the request timeout; an unconfigured tick is 10 ms and 26 MB peak RSS.
      Nothing resident between ticks, so the receipt is unchanged
- [ ] Live, on `beebee` over Tailscale, keys from Mitch (not done: no keys in this
      session, and paths and field names are from the spec and upstream docs, not yet
      checked against a live instance):
  - [ ] Radarr and Sonarr only: within a tick, recent imports and coming up listed, the
        footer counts match the apps
  - [x] v2 endpoints checked against live responses (2026-11-24, saved by Mitch's own
        run of a read-only probe): history `records` with `movie` / `series` + `episode`,
        `quality.quality.resolution`, Bazarr `missing_subtitles` objects with `code2` and a
        boolean `forced`, one root folder per app on the same disk. One miss, fixed:
        Radarr's history omits the movie file, so the DV/HDR badge reads the cached
        `/movie` list (`movieRanges`). Both calendars were empty, so Coming up is
        unproven live
  - [ ] Break the Radarr key: red cell, "Radarr rejected the API key"; fix it, recovers
  - [ ] A download running: accent cell and a progress row
  - [ ] Pipeline URL set: an injected warning reads "no forced English subtitles"
  - [ ] Tick time and RSS against the real stack

## Out of scope

Actions (search, retry, delete), a panel, Lidarr/Readarr/Whisparr, Plex. The beebee side
(Bazarr on the tailnet, the status endpoint) is Beebee's.

## Risks / open questions

- Field names drift between \*arr releases; every reader tolerates a missing field, and a
  payload that does not parse is "unexpected response" on that app's row.
- Bazarr's health entries carry no level; they are shown as warnings.
