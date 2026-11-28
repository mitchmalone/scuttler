// scuttler widget: a self-hosted *arr media stack (docs/WIDGETS.md).
//
// Radarr, Sonarr, Prowlarr and Bazarr, each optional: give an app a URL and an
// API key in Settings → Widgets and it joins the card. Most of the time the
// card answers what's new, what's coming and what's in flight; problems go on
// top when there are any (v2, Mitch 2026-11-24). Top to bottom: issues (health,
// low disks, disabled indexers, an app down or refusing its key, an episode
// aired and not grabbed, titles without English subtitles), downloads and the
// running conversion, the last five imports of the past week, the next five
// releases of the next two weeks; a dim footer counts the library. The cell is
// a clapperboard: plain when idle, accent with a count while downloading or
// when something was imported today, amber with a count on warnings, a red
// triangle on errors. Issues are the card's untitled rows; the rest are
// titled sections (In flight, Recently added, Coming up) and a split footer.
//
// Why API keys and not a login: every *arr API authenticates with the app's
// API key (Settings → General → Security in each app). The key travels only
// in the `X-Api-Key` header; it never appears in a URL, a row, or stderr.
//
// PIPELINE_STATUS_URL (optional) points at a status.json describing a
// post-processing queue (shape: `PipelineStatus` below), for failures that
// happen after import and so never reach the *arr apps.
//
// Every request has a 5 s timeout and the whole tick a 15 s deadline; an app
// that does not answer is a red row, never a failed tick. The only state kept
// between ticks is a small cache: when each app last answered, since when a
// download has been waiting to import, and the library counts (the full movie
// and series lists are fetched at most every 15 minutes).
//
// "New" is today (since local midnight): the host does not tell a widget when
// its card was opened, so there is no "since you last looked".
//
// Install: copy into ~/.config/scuttler/widgets/. Runs under Bun or Node.
import type {
  WidgetAction,
  WidgetRow,
  WidgetSection,
  WidgetTone,
  WidgetView,
} from '@scuttler/tui/bar/types'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type ArrId = 'radarr' | 'sonarr' | 'prowlarr' | 'bazarr'
export type AppId = ArrId | 'pipeline'

export type Issue = {
  app: AppId
  level: 'warn' | 'error'
  text: string
  /** Row hint; the app's name when absent. */
  hint?: string
  link?: string
  /** Fixed in scuttler's Settings, not in the app: the row opens Settings. */
  configure?: true
}

export type Download = {
  app: AppId
  title: string
  /** 0–100; absent when the source reports no size. */
  progress?: number
  eta?: string
  level: 'ok' | 'warn' | 'error'
  /** Why it isn't fine; on a healthy row, what it's doing ('verify'). */
  note?: string
}

export type AppSnapshot =
  | { app: AppId; state: 'unconfigured' }
  | { app: AppId; state: 'misconfigured'; reason: string }
  | {
      app: AppId
      state: 'down'
      url: string
      reason: string
      /** Epoch ms of the last tick that reached it. */
      lastOkAt?: number
    }
  | { app: AppId; state: 'auth'; url: string; reason: string }
  | {
      app: AppId
      state: 'up'
      url: string
      issues: Issue[]
      downloads: Download[]
      /** Radarr and Sonarr: imports of the past 7 days. */
      recent?: Recent[]
      /** Radarr and Sonarr: releases in the next 14 days. */
      upcoming?: Upcoming[]
      /** Radarr: movies with a file. Sonarr: series with at least one. */
      library?: number
      /** Largest free space across the app's root folders, in bytes. */
      free?: number
    }

/** One import: a movie or an episode that landed in the library. */
export type Recent = {
  app: 'radarr' | 'sonarr'
  /** Dedupe key: the movie or episode id. */
  key: string
  title: string
  at: number
  /** '4K DV' (accent), '1080p' (dim). */
  badge?: { text: string; tone?: WidgetTone }
  /** Path under the app's URL: `/movie/<slug>`, `/series/<slug>`. */
  path?: string
}

/** One release coming up: an episode airing or a movie's digital/physical date. */
export type Upcoming = {
  app: 'radarr' | 'sonarr'
  title: string
  at: number
  /** 'digital', 'physical'; none for an episode. */
  kind?: string
  path?: string
}

const ARRS: ArrId[] = ['radarr', 'sonarr', 'prowlarr', 'bazarr']
const ORDER: AppId[] = [...ARRS, 'pipeline']
const NAMES: Record<AppId, string> = {
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  prowlarr: 'Prowlarr',
  bazarr: 'Bazarr',
  pipeline: 'Pipeline',
}
/** lucide glyphs for each app's service in Settings. */
const ICONS: Record<ArrId, string> = {
  radarr: 'film',
  sonarr: 'tv',
  prowlarr: 'search',
  bazarr: 'captions',
}
const SETTINGS_PATH = 'Settings → Widgets'
/** A row that opens Settings at the Widgets page, where the keys go. */
const CONFIGURE: WidgetAction = { type: 'settings', value: 'widgets' }
const MAX_ROWS = 14
const MAX_DOWNLOADS = 5
const TITLE_CHARS = 48
const TEXT_CHARS = 90
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const GB = 1024 ** 3
const STALE_IMPORT = 30 * MINUTE
const RECENT_WINDOW = 7 * DAY
const UPCOMING_WINDOW = 14 * DAY
/** An aired episode or released movie without a file warns after this. */
const LATE = DAY
const LIST_ROWS = 5
const LIBRARY_TTL = 15 * MINUTE
const PIPELINE_WINDOW = 7 * DAY
const REQUEST_TIMEOUT = 5000
const TICK_DEADLINE = 15_000
const PER_APP_CONCURRENCY = 4

const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const WEEKDAYS = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ')

const REASONS: Record<string, string> = {
  'no-forced-main-language': 'no forced English subs',
}

export function manifest() {
  // Each app is a service (Settings → Widgets → Media stack, DECISIONS
  // 2026-11-27): its URL and API key, delivered in SCUTTLER_SERVICES.
  const app = (id: ArrId, port: number) => ({
    type: id,
    name: NAMES[id],
    icon: ICONS[id],
    settings: [
      {
        key: `${id.toUpperCase()}_URL`,
        label: 'URL',
        hint: `e.g. http://beebee:${port}`,
        required: true,
      },
      {
        key: `${id.toUpperCase()}_API_KEY`,
        label: 'API key',
        hint: `${NAMES[id]} → Settings → General → Security (the API key, not your login)`,
        secret: true,
        required: true,
      },
    ],
    requires: [],
  })
  return {
    id: 'arr',
    name: 'Media stack',
    interval: 60,
    zone: 'right',
    icon: 'clapperboard',
    timeout: 20,
    services: [
      app('radarr', 7878),
      app('sonarr', 8989),
      app('prowlarr', 9696),
      app('bazarr', 6767),
    ],
    settings: [
      {
        key: 'PIPELINE_STATUS_URL',
        label: 'Pipeline status URL (optional)',
        hint: 'a status.json describing post-processing',
      },
    ],
  }
}

/**
 * One app's URL and key: the first service of its type in SCUTTLER_SERVICES,
 * else the flat env settings older builds sent. Pure over its inputs.
 */
export function appSettings(
  id: ArrId,
  services: string | undefined,
  env: Record<string, string | undefined>,
): { url: string; key: string } {
  const U = id.toUpperCase()
  let parsed: unknown = []
  try {
    parsed = JSON.parse(services ?? '[]')
  } catch {
    parsed = []
  }
  const svc = list(parsed).find((s) => s.type === id)
  // Delivered services are the whole truth: no fallback to flat keys then.
  const from =
    services === undefined ? null : isRecord(svc?.settings) ? svc.settings : {}
  const pick = (k: string) =>
    (from
      ? typeof from[k] === 'string'
        ? from[k]
        : ''
      : (env[k] ?? '')
    ).trim()
  return { url: pick(`${U}_URL`), key: pick(`${U}_API_KEY`) }
}

/* ---- pure helpers ---------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(isRecord) : []
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const lower = (v: unknown): string => (str(v) ?? '').toLowerCase()
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v)
  return s && /^https?:\/\//i.test(s) ? s : undefined
}

/**
 * What the user typed, as a base URL: trimmed, `http://` when no scheme, no
 * trailing slash, base path kept. Credentials, query and fragment are dropped
 * so nothing secret can ride into a row's `open`. Null when it isn't a URL.
 */
export function normalizeUrl(raw: string | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** `text` cut to `max` characters with the ellipsis in the middle. */
export function middle(text: string, max = TITLE_CHARS): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`
}

const clip = (text: string, max = TEXT_CHARS): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

const basename = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path
/** A file name without its extension: 'The Bear S03E01.mkv' → 'The Bear S03E01'. */
const stem = (name: string): string => name.replace(/\.[a-z0-9]{2,4}$/i, '')

/** '12m' / '2h 5m' / '3d' for a duration in ms. */
export function span(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MINUTE))
  if (m < 60) return `${m}m`
  if (m < 24 * 60)
    return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
  return `${Math.floor(m / (24 * 60))}d`
}

/** An *arr `timeleft` ('00:12:34', '1.02:03:04') as '12m' / '1d'. */
export function eta(timeleft: unknown): string | undefined {
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(str(timeleft) ?? '')
  if (!m) return undefined
  const [d, h, min, s] = m.slice(1).map((p) => Number(p ?? 0)) as [
    number,
    number,
    number,
    number,
  ]
  const ms = ((d * 24 + h) * 60 + min) * MINUTE + s * 1000
  return ms < MINUTE ? '<1m' : span(ms)
}

function bytes(n: number): string {
  if (n >= 1024 * GB) return `${(n / (1024 * GB)).toFixed(1)} TB`
  if (n >= GB) return `${Math.round(n / GB)} GB`
  return `${Math.round(n / 1024 ** 2)} MB`
}

/** 'HH:MM' today, 'Mon D HH:MM' otherwise, in local time. */
function clock(at: number, now: number): string {
  const d = new Date(at)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (new Date(now).toDateString() === d.toDateString()) return hm
  return `${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })} ${hm}`
}

/** '12m' / '2h' / '3d': how long ago, one unit. */
export function ago(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MINUTE))
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`
  return `${Math.floor(m / (24 * 60))}d`
}

/** 'today' / 'tomorrow' / 'Thu' within the week / '12 Dec' after, local time. */
export function when(at: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((day(at) - day(now)) / DAY)
  const d = new Date(at)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1 && days < 7) return WEEKDAYS[d.getDay()]!
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/* ---- classification (pure) ------------------------------------------ */

/**
 * `/health`: `error` and `warning` become issues, `notice` and `ok` are
 * dropped. Bazarr's shape is `{data: [{object, issue}]}` with no level, so its
 * entries are warnings.
 */
export function healthIssues(app: AppId, body: unknown): Issue[] {
  if (isRecord(body)) {
    return list(body.data).flatMap((h) => {
      const issue = str(h.issue)
      if (!issue) return []
      const object = str(h.object)
      return [
        {
          app,
          level: 'warn' as const,
          text: clip(object ? `${object}: ${issue}` : issue),
        },
      ]
    })
  }
  return list(body).flatMap((h) => {
    const type = lower(h.type)
    const text = str(h.message)
    if (!text || (type !== 'error' && type !== 'warning')) return []
    return [
      {
        app,
        level: type === 'error' ? ('error' as const) : ('warn' as const),
        text: clip(text),
        link: httpUrl(h.wikiUrl),
      },
    ]
  })
}

/** The key a queue record's "waiting to import since" is cached under. */
export const pendingKey = (app: AppId, record: Record<string, unknown>) =>
  `${app}:${String(record.id ?? record.downloadId ?? record.title ?? '')}`

export const isImportPending = (record: Record<string, unknown>) =>
  lower(record.trackedDownloadState) === 'importpending'

const movieTitle = (m: Record<string, unknown>): string | undefined => {
  const title = str(m.title)
  const year = num(m.year)
  return title && year ? `${title} (${year})` : title
}

/** 'Monarch S01E05', with ' · <episode title>' when `withName`. */
const episodeTitle = (
  series: string,
  ep: Record<string, unknown>,
  withName = false,
): string => {
  const s = num(ep.seasonNumber)
  const e = num(ep.episodeNumber)
  const base =
    s !== undefined && e !== undefined
      ? `${series} S${pad2(s)}E${pad2(e)}`
      : series
  const name = withName ? str(ep.title) : undefined
  return name && !/^(episode|tba)\b/i.test(name) ? `${base} · ${name}` : base
}

const slugPath = (kind: 'movie' | 'series', o: unknown) => {
  const slug = isRecord(o) ? str(o.titleSlug) : undefined
  return slug ? `/${kind}/${encodeURIComponent(slug)}` : undefined
}

function queueTitle(r: Record<string, unknown>): string {
  const movie = isRecord(r.movie) ? movieTitle(r.movie) : undefined
  if (movie) return movie
  const series = isRecord(r.series) ? str(r.series.title) : undefined
  if (series) {
    return episodeTitle(series, isRecord(r.episode) ? r.episode : {}, true)
  }
  return str(r.title) ?? 'download'
}

/** '4K', '1080p', plus 'DV' or 'HDR' when the file's dynamic range says so. */
export function qualityBadge(
  quality: unknown,
  mediaInfo?: unknown,
): { text: string; tone?: WidgetTone } | undefined {
  const q =
    isRecord(quality) && isRecord(quality.quality) ? quality.quality : {}
  const res = num(q.resolution)
  const size = res ? (res >= 2160 ? '4K' : `${res}p`) : undefined
  const range = isRecord(mediaInfo)
    ? lower(mediaInfo.videoDynamicRangeType)
    : ''
  const hdr = range.includes('dv')
    ? 'DV'
    : range.includes('hdr') || range.includes('hlg')
      ? 'HDR'
      : undefined
  const text = [size, hdr].filter(Boolean).join(' ')
  if (!text) return undefined
  // 4K or a dynamic range is the detail worth seeing; 1080p stays dim.
  return size === '4K' || hdr ? { text, tone: 'accent' } : { text }
}

/**
 * `/history?eventType=3` (downloadFolderImported) as imports of the past
 * 7 days, newest first, one per movie or episode. Radarr's history carries
 * the movie but not its file, so the dynamic range comes from `ranges` (movie
 * id → `videoDynamicRangeType`, from the `/movie` list: `movieRanges`).
 */
export function recentImports(
  app: 'radarr' | 'sonarr',
  body: unknown,
  now: number,
  ranges: Record<string, string> = {},
): Recent[] {
  const records = isRecord(body) ? list(body.records) : list(body)
  const seen = new Set<string>()
  const out: Recent[] = []
  for (const r of records) {
    const at = Date.parse(str(r.date) ?? '')
    if (!(now - at <= RECENT_WINDOW)) continue
    let item: Recent | null = null
    if (app === 'radarr') {
      const movie = isRecord(r.movie) ? r.movie : {}
      const id = num(r.movieId) ?? num(movie.id)
      const title = movieTitle(movie) ?? str(r.sourceTitle)
      if (id === undefined || !title) continue
      const file = isRecord(movie.movieFile) ? movie.movieFile : {}
      const range = ranges[String(id)]
      item = {
        app,
        key: `movie:${id}`,
        title,
        at,
        badge: qualityBadge(
          r.quality,
          range ? { videoDynamicRangeType: range } : file.mediaInfo,
        ),
        path: slugPath('movie', movie),
      }
    } else {
      const series = isRecord(r.series) ? r.series : {}
      const ep = isRecord(r.episode) ? r.episode : {}
      const id = num(r.episodeId) ?? num(ep.id)
      const name = str(series.title)
      if (id === undefined || !name) continue
      item = {
        app,
        key: `episode:${id}`,
        title: episodeTitle(name, ep, true),
        at,
        badge: qualityBadge(r.quality),
        path: slugPath('series', series),
      }
    }
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out.sort((a, b) => b.at - a.at)
}

/**
 * `/calendar` over [now − 7 days, now + 14 days]: what is coming up, and what
 * aired or was released more than a day ago without a file (a warning).
 * Episodes air at `airDateUtc`; a movie's date is its earliest digital or
 * physical release (cinema dates are not something you can grab).
 */
export function calendarItems(
  app: 'radarr' | 'sonarr',
  body: unknown,
  now: number,
): { upcoming: Upcoming[]; late: Issue[] } {
  const upcoming: Upcoming[] = []
  const late: Issue[] = []
  for (const c of list(body)) {
    if (c.monitored === false || c.hasFile === true) continue
    let title: string | undefined
    let at = NaN
    let kind: string | undefined
    let path: string | undefined
    if (app === 'sonarr') {
      const series = isRecord(c.series) ? c.series : {}
      const name = str(series.title)
      if (!name) continue
      title = episodeTitle(name, c)
      at = Date.parse(str(c.airDateUtc) ?? '')
      path = slugPath('series', series)
    } else {
      title = str(c.title)
      const dates = (['digital', 'physical'] as const)
        .map((k) => ({ k, at: Date.parse(str(c[`${k}Release`]) ?? '') }))
        .filter((d) => Number.isFinite(d.at))
        .sort((a, b) => a.at - b.at)
      // The next release still ahead, else the latest one already past.
      const next = dates.find((d) => d.at >= now) ?? dates[dates.length - 1]
      if (next) {
        at = next.at
        kind = next.k
      }
      path = slugPath('movie', c)
    }
    if (!title || !Number.isFinite(at)) continue
    if (at >= now && at - now <= UPCOMING_WINDOW) {
      upcoming.push({ app, title, at, kind, path })
    } else if (now - at > LATE && now - at <= RECENT_WINDOW) {
      late.push({
        app,
        level: 'warn',
        text: `${middle(title, 36)} ${app === 'sonarr' ? 'aired' : 'released'}, not grabbed`,
        hint: `${NAMES[app]} · ${ago(now - at)}`,
        link: path,
      })
    }
  }
  return { upcoming: upcoming.sort((a, b) => a.at - b.at), late }
}

/**
 * Bazarr `/movies/wanted` or `/episodes/wanted`: how many items lack full
 * English subtitles. Forced-only gaps don't count: a forced English track
 * often doesn't exist for a title anywhere, so counting it never clears.
 * `missing_subtitles` entries are objects (`code2`, `forced`) or, on older
 * releases, strings like 'en' / 'en:forced'.
 */
export function englishGaps(body: unknown): number {
  const rows = isRecord(body) ? list(body.data) : list(body)
  return rows.filter((r) =>
    (Array.isArray(r.missing_subtitles) ? r.missing_subtitles : []).some(
      (m: unknown) => {
        if (typeof m === 'string') {
          const [code, flag] = m.toLowerCase().split(':')
          return code === 'en' && flag !== 'forced'
        }
        if (!isRecord(m)) return false
        const forced = m.forced === true || lower(m.forced) === 'true'
        return lower(m.code2) === 'en' && !forced
      },
    ),
  ).length
}

/** Radarr `/movie`: movies with a file. Sonarr `/series`: series with one. */
export function libraryCount(app: 'radarr' | 'sonarr', body: unknown): number {
  return list(body).filter((x) =>
    app === 'radarr'
      ? x.hasFile === true
      : (num(isRecord(x.statistics) ? x.statistics.episodeFileCount : 0) ?? 0) >
        0,
  ).length
}

/** Radarr `/movie`: movie id → its file's dynamic range, where it has one. */
export function movieRanges(body: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of list(body)) {
    const id = num(m.id)
    const file = isRecord(m.movieFile) ? m.movieFile : {}
    const info = isRecord(file.mediaInfo) ? file.mediaInfo : {}
    const range = str(info.videoDynamicRangeType)
    if (id !== undefined && range) out[String(id)] = range
  }
  return out
}

/** Largest free space across `/rootfolder` entries, in bytes. */
export function freeSpace(rootfolders: unknown): number | undefined {
  const free = list(rootfolders)
    .map((r) => num(r.freeSpace))
    .filter((n): n is number => n !== undefined)
  return free.length ? Math.max(...free) : undefined
}

/**
 * `/queue` records as downloads. `pendingSince` maps `pendingKey` to the epoch
 * ms the record was first seen waiting to import (the API carries no such
 * time); a wait past 30 minutes is a warning.
 */
export function queueDownloads(
  app: AppId,
  body: unknown,
  now: number,
  pendingSince: Record<string, number> = {},
): Download[] {
  const records = isRecord(body) ? list(body.records) : list(body)
  return records.map((r) => {
    const tracked = lower(r.trackedDownloadStatus)
    const state = lower(r.trackedDownloadState)
    const status = lower(r.status)
    const waited = isImportPending(r)
      ? now - (pendingSince[pendingKey(app, r)] ?? now)
      : 0
    const level: Download['level'] =
      tracked === 'error' ||
      status === 'failed' ||
      ['importblocked', 'failedpending', 'failed'].includes(state)
        ? 'error'
        : tracked === 'warning' ||
            status === 'warning' ||
            status === 'stalled' ||
            waited > STALE_IMPORT
          ? 'warn'
          : 'ok'
    const message =
      list(r.statusMessages)
        .flatMap((m) => (Array.isArray(m.messages) ? m.messages : []))
        .map(str)
        .find((m) => m !== undefined) ?? str(r.errorMessage)
    const size = num(r.size) ?? 0
    const left = num(r.sizeleft) ?? 0
    return {
      app,
      title: queueTitle(r),
      progress:
        size > 0
          ? Math.min(100, Math.max(0, Math.round(((size - left) / size) * 100)))
          : undefined,
      eta: eta(r.timeleft),
      level,
      note:
        level === 'ok'
          ? undefined
          : clip(
              message ??
                (waited > STALE_IMPORT
                  ? `waiting to import for ${span(waited)}`
                  : status || state || 'needs attention'),
            ),
    }
  })
}

/**
 * Free space per root folder (`/rootfolder`), with totals from `/diskspace`
 * (the mount holding the root). Only roots are judged: `/diskspace` also lists
 * small system mounts that would alarm for nothing. Under 5 % or 50 GB warns;
 * under 1 % or 10 GB is an error. One issue per mount.
 */
export function diskIssues(
  app: AppId,
  rootfolders: unknown,
  diskspace: unknown,
): Issue[] {
  const disks = list(diskspace).flatMap((d) => {
    const path = str(d.path)
    const total = num(d.totalSpace)
    return path && total ? [{ path, total }] : []
  })
  const seen = new Set<string>()
  return list(rootfolders).flatMap((r) => {
    const path = str(r.path)
    const free = num(r.freeSpace)
    if (!path || free === undefined) return []
    const disk = disks
      .filter(
        (d) =>
          path === d.path ||
          path.startsWith(d.path.endsWith('/') ? d.path : `${d.path}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]
    const key = disk?.path ?? path
    if (seen.has(key)) return []
    seen.add(key)
    const pct = disk ? (free / disk.total) * 100 : 100
    const level =
      pct < 1 || free < 10 * GB
        ? ('error' as const)
        : pct < 5 || free < 50 * GB
          ? ('warn' as const)
          : null
    if (!level) return []
    return [{ app, level, text: `${bytes(free)} free on ${clip(path, 40)}` }]
  })
}

/** Prowlarr `/indexerstatus` entries still disabled, named from `/indexer`. */
export function indexerIssues(
  statuses: unknown,
  indexers: unknown,
  now: number,
): Issue[] {
  const names = new Map(
    list(indexers).map((i) => [num(i.id), str(i.name)] as const),
  )
  return list(statuses).flatMap((s) => {
    const till = Date.parse(str(s.disabledTill) ?? '')
    if (!(till > now)) return []
    const id = num(s.indexerId)
    const name = names.get(id) ?? (id !== undefined ? `#${id}` : 'an indexer')
    return [
      {
        app: 'prowlarr' as const,
        level: 'warn' as const,
        text: `Indexer ${name} disabled until ${clock(till, now)}`,
      },
    ]
  })
}

/**
 * The optional post-processing status file:
 *
 *   { "version": 1, "generatedAt": "…",
 *     "queue": { "pending": 1, "running": { "path": "…", "startedAt": "…" } },
 *     "failures": [ { "path": "…", "reason": "…", "time": "…" } ],
 *     "warnings": [ { "path": "…", "reason": "…", "time": "…" } ] }
 *
 * Failures are errors, warnings are warnings, both only from the last 7 days;
 * unknown fields are ignored and a newer `version` renders what is understood.
 */
export function pipelineSnapshot(
  body: unknown,
  url: string,
  now: number,
): AppSnapshot {
  if (!isRecord(body)) {
    return {
      app: 'pipeline',
      state: 'down',
      url,
      reason: 'unexpected response',
    }
  }
  const recent = (level: Issue['level'], entries: unknown): Issue[] =>
    list(entries).flatMap((e) => {
      const path = str(e.path)
      if (!path) return []
      const at = Date.parse(str(e.time) ?? '')
      if (now - at > PIPELINE_WINDOW) return []
      const reason = str(e.reason) ?? 'failed'
      return [
        {
          app: 'pipeline' as const,
          level,
          text: clip(
            `${middle(stem(basename(path)), 36)}: ${REASONS[reason] ?? reason}`,
          ),
          hint: 'pipeline',
        },
      ]
    })
  const queue = isRecord(body.queue) ? body.queue : {}
  const job = isRecord(queue.running) ? queue.running : {}
  const running = str(job.path)
  return {
    app: 'pipeline',
    state: 'up',
    url,
    issues: [
      ...recent('error', body.failures),
      ...recent('warn', body.warnings),
    ],
    downloads: running
      ? [
          {
            app: 'pipeline',
            title: `Converting ${stem(basename(running))}`,
            level: 'ok',
            note: str(job.stage),
            progress: num(job.progress),
          },
        ]
      : [],
  }
}

/* ---- the view (pure) ------------------------------------------------- */

const RANK = { error: 0, warn: 1, ok: 2 } as const
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const open = (value: string | undefined): WidgetAction | null =>
  value ? { type: 'open', value } : null

/** The cell and card for one tick's snapshots. No I/O. */
export function toView(snaps: AppSnapshot[], now: number): WidgetView {
  const configured = ORDER.flatMap((id) =>
    snaps.filter((s) => s.app === id && s.state !== 'unconfigured'),
  )
  if (!configured.length) {
    return {
      setup: {
        message: `add at least one *arr app (URL + API key) — ${SETTINGS_PATH}`,
      },
    }
  }
  const arrs = configured.filter((s) => s.app !== 'pipeline')
  if (arrs.length && arrs.every((s) => s.state === 'auth')) {
    return {
      setup: {
        message: `${arrs.length === 1 ? `${NAMES[arrs[0]!.app]} rejected its API key` : 'every app rejected its API key'} — set ${arrs.length === 1 ? 'it' : 'them'} again in ${SETTINGS_PATH}`,
      },
    }
  }

  const urls = new Map<AppId, string>()
  const issues: Issue[] = []
  const downloads: Download[] = []
  const recent: Recent[] = []
  const upcoming: Upcoming[] = []
  const library: Partial<Record<AppId, number>> = {}
  let free: number | undefined
  for (const s of configured) {
    const name = NAMES[s.app]
    if (s.state !== 'misconfigured' && s.state !== 'unconfigured') {
      urls.set(s.app, s.url)
    }
    if (s.state === 'misconfigured') {
      issues.push({
        app: s.app,
        level: 'warn',
        text: `${name}: ${s.reason}`,
        hint: 'Configure',
        configure: true,
      })
    } else if (s.state === 'down') {
      const seen =
        s.lastOkAt !== undefined
          ? ` · ok ${now - s.lastOkAt < MINUTE ? 'just now' : `${ago(now - s.lastOkAt)} ago`}`
          : ''
      issues.push({
        app: s.app,
        level: 'error',
        text:
          s.app === 'pipeline'
            ? 'Pipeline status unreachable'
            : `${name} unreachable`,
        hint: `${s.reason}${seen}`,
      })
    } else if (s.state === 'auth') {
      issues.push({
        app: s.app,
        level: 'error',
        text: `${name} rejected the API key`,
        hint: 'Configure',
        configure: true,
      })
    } else if (s.state === 'up') {
      issues.push(...s.issues)
      downloads.push(...s.downloads)
      recent.push(...(s.recent ?? []))
      upcoming.push(...(s.upcoming ?? []))
      if (s.library !== undefined) library[s.app] = s.library
      if (s.free !== undefined) free = Math.max(free ?? 0, s.free)
    }
  }
  issues.sort((a, b) => RANK[a.level] - RANK[b.level])
  downloads.sort(
    (a, b) =>
      RANK[a.level] - RANK[b.level] || (b.progress ?? 0) - (a.progress ?? 0),
  )
  recent.sort((a, b) => b.at - a.at)
  upcoming.sort((a, b) => a.at - b.at)

  const bad = downloads.filter((d) => d.level !== 'ok')
  // Downloading means the *arr queue; a conversion is in flight, not a download.
  const active = downloads.filter(
    (d) => d.level === 'ok' && d.app !== 'pipeline',
  ).length
  const problems = issues.length + bad.length
  const anyError = [...issues, ...bad].some((p) => p.level === 'error')
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const fresh = recent.filter((r) => r.at >= midnight.getTime()).length

  // The app to open: the one with the worst problem, in app order on ties.
  const worst = (app: AppId) =>
    Math.min(
      2,
      ...[...issues, ...bad]
        .filter((p) => p.app === app)
        .map((p) => RANK[p.level]),
    )
  // The status file is only worth opening when there is no app to open.
  const target =
    ARRS.filter((id) => urls.has(id) && worst(id) < 2).sort(
      (a, b) => worst(a) - worst(b),
    )[0] ?? ORDER.find((id) => urls.has(id))

  // 14 rows, filled in priority order: issues, in flight, new, coming up.
  let room = MAX_ROWS
  const take = <T>(items: T[], max = MAX_ROWS): T[] => {
    const out = items.slice(0, Math.min(max, room))
    room -= out.length
    return out
  }
  const shownIssues = take(issues)
  const shownDownloads = take(downloads, MAX_DOWNLOADS)
  const shownRecent = take(recent, LIST_ROWS)
  const shownUpcoming = take(upcoming, LIST_ROWS)
  const more =
    issues.length -
    shownIssues.length +
    (downloads.length - shownDownloads.length)
  const at = (app: AppId, path: string | undefined) => {
    const base = urls.get(app)
    return open(base && path ? `${base}${path}` : base)
  }

  const rows: WidgetRow[] = shownIssues.map((i) => ({
    dot: i.level,
    text: i.text,
    hint: i.hint ?? NAMES[i.app],
    action: i.configure
      ? CONFIGURE
      : i.link && !/^https?:/i.test(i.link)
        ? at(i.app, i.link)
        : open(i.link ?? urls.get(i.app)),
  }))
  const sections: WidgetSection[] = [
    {
      title: 'In flight',
      rows: shownDownloads.map((d) => {
        const base = urls.get(d.app)
        const ok = d.level === 'ok'
        const status = [
          d.progress !== undefined ? `${d.progress}%` : null,
          d.eta ?? null,
        ].filter(Boolean)
        return {
          dot: (ok ? 'accent' : d.level) satisfies WidgetTone,
          text: middle(d.title),
          hint: ok
            ? status.join(' · ') || (d.note ? `${d.note}…` : null)
            : (d.note ?? null),
          progress: ok ? (d.progress ?? null) : null,
          action: open(
            base && d.app !== 'pipeline' ? `${base}/activity/queue` : base,
          ),
        }
      }),
    },
    {
      title: 'Recently added',
      rows: shownRecent.map((r) => ({
        dot: 'ok',
        text: middle(r.title),
        hint: ago(now - r.at),
        badge: r.badge ?? null,
        action: at(r.app, r.path),
      })),
    },
    {
      title: 'Coming up',
      rows: shownUpcoming.map((u) => ({
        dot: 'muted',
        text: middle(u.title),
        hint: [u.kind, when(u.at, now)].filter(Boolean).join(' · '),
        action: at(u.app, u.path),
      })),
    },
  ].filter((section) => section.rows.length > 0)

  const counts = [
    library.radarr !== undefined ? plural(library.radarr, 'movie') : null,
    library.sonarr !== undefined ? plural(library.sonarr, 'show') : null,
  ].filter(Boolean)
  const subtitle = [
    problems ? plural(problems, 'issue') : null,
    active ? `${active} downloading` : null,
    fresh ? `${fresh} new today` : null,
  ].filter(Boolean)
  return {
    icon: anyError ? 'triangle-alert' : 'clapperboard',
    // A quiet cell (Mitch, 2026-11-28): no count, and colour only when
    // something is wrong. Downloads and new arrivals live in the card.
    label: null,
    tone: anyError ? 'error' : problems ? 'warn' : 'ok',
    click: open(target ? urls.get(target) : undefined),
    card: {
      title: 'Media stack',
      subtitle: subtitle.join(' · ') || 'all good',
      rows,
      sections,
      footer:
        counts.length || free !== undefined
          ? {
              left: counts.join(' · ') || null,
              right: free !== undefined ? `${bytes(free)} free` : null,
            }
          : null,
      hint: more > 0 ? `+${more} more` : null,
    },
  }
}

/* ---- I/O ------------------------------------------------------------- */

type Cache = {
  apps: Partial<Record<AppId, { lastOkAt: number }>>
  /** `pendingKey` → epoch ms first seen waiting to import. */
  pending: Record<string, number>
  /** Library counts and when they were fetched (`LIBRARY_TTL`). */
  library?: Partial<
    Record<
      'radarr' | 'sonarr',
      {
        count: number
        at: number
        /** Radarr: movie id → dynamic range, for the import badges. */
        ranges?: Record<string, string>
      }
    >
  >
}

type Fetched =
  | { ok: true; body: unknown }
  | { ok: false; kind: 'auth' | 'missing' | 'down'; reason: string }

function cachePath(): string {
  const base =
    process.env.XDG_CACHE_HOME ??
    join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache')
  return join(base, 'scuttler', 'widgets', 'arr.json')
}

function readCache(): Cache {
  try {
    const raw: unknown = JSON.parse(readFileSync(cachePath(), 'utf8'))
    if (isRecord(raw) && isRecord(raw.apps) && isRecord(raw.pending)) {
      return raw as Cache
    }
  } catch {
    // no cache yet, or an unreadable one: start clean
  }
  return { apps: {}, pending: {} }
}

function writeCache(cache: Cache): void {
  try {
    const path = cachePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, JSON.stringify(cache), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  } catch {
    // the cache is a nicety; a read-only home must not fail the tick
  }
}

/**
 * One GET. Failures come back as short fixed reasons, never the URL or the
 * transport's own message. Redirects are refused: a wrong base path lands on a
 * login page, and following one elsewhere would carry the key along.
 */
async function getJson(
  url: string,
  key: string | null,
  deadline: AbortSignal,
): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'scuttler-widget',
        // Header names are case-insensitive: this is Bazarr's X-API-KEY too.
        ...(key ? { 'X-Api-Key': key } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT), deadline]),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: 'auth', reason: String(res.status) }
    }
    if (res.status === 404) return { ok: false, kind: 'missing', reason: '404' }
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, kind: 'down', reason: 'redirected (check the URL)' }
    }
    if (!res.ok) return { ok: false, kind: 'down', reason: String(res.status) }
    try {
      return { ok: true, body: (await res.json()) as unknown }
    } catch {
      return { ok: false, kind: 'down', reason: 'unexpected response' }
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    return {
      ok: false,
      kind: 'down',
      reason:
        name === 'TimeoutError' || name === 'AbortError'
          ? 'timeout'
          : 'unreachable',
    }
  }
}

/** Run at most `max` of the given tasks at once. */
function limiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((go) => waiting.push(go))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

function settings(id: ArrId): { url: string; key: string } | AppSnapshot {
  const { url: rawUrl, key } = appSettings(
    id,
    process.env.SCUTTLER_SERVICES,
    process.env,
  )
  if (!rawUrl && !key) return { app: id, state: 'unconfigured' }
  if (!rawUrl) return { app: id, state: 'misconfigured', reason: 'URL missing' }
  if (!key) {
    return { app: id, state: 'misconfigured', reason: 'API key missing' }
  }
  const url = normalizeUrl(rawUrl)
  if (!url) {
    return { app: id, state: 'misconfigured', reason: 'URL is not valid' }
  }
  return { url, key }
}

async function arrSnapshot(
  id: ArrId,
  cache: Cache,
  now: number,
  deadline: AbortSignal,
): Promise<AppSnapshot> {
  const cfg = settings(id)
  if ('state' in cfg) return cfg
  const { url, key } = cfg
  const api =
    id === 'bazarr' ? '/api' : id === 'prowlarr' ? '/api/v1' : '/api/v3'
  const limit = limiter(PER_APP_CONCURRENCY)
  const get = (path: string) =>
    limit(() => getJson(`${url}${api}${path}`, key, deadline))

  const status = await get('/system/status')
  if (!status.ok) {
    return status.kind === 'auth'
      ? { app: id, state: 'auth', url, reason: status.reason }
      : {
          app: id,
          state: 'down',
          url,
          reason: status.reason,
          lastOkAt: cache.apps[id]?.lastOkAt,
        }
  }
  const issues: Issue[] = []
  /** A secondary endpoint: its body, or undefined with the failure noted. */
  const part = async (label: string, path: string): Promise<unknown> => {
    const res = await get(path)
    if (res.ok) return res.body
    // Older releases lack some endpoints: a 404 is skipped, not reported.
    if (res.kind !== 'missing') {
      issues.push({
        app: id,
        level: 'warn',
        text: `${NAMES[id]}: ${label} unavailable (${res.reason})`,
      })
    }
    return undefined
  }
  const snap: AppSnapshot & { state: 'up' } = {
    app: id,
    state: 'up',
    url,
    issues,
    downloads: [],
  }

  if (id === 'bazarr') {
    const [health, movies, episodes] = await Promise.all([
      part('health', '/system/health'),
      part('wanted movies', '/movies/wanted?start=0&length=-1'),
      part('wanted episodes', '/episodes/wanted?start=0&length=-1'),
    ])
    issues.push(...healthIssues(id, health))
    const movieGaps = englishGaps(movies)
    const gaps = movieGaps + englishGaps(episodes)
    if (gaps > 0) {
      issues.push({
        app: id,
        level: 'warn',
        text: `${plural(gaps, 'title')} without English subs`,
        link: movieGaps ? '/wanted/movies' : '/wanted/series',
      })
    }
    return snap
  }

  if (id === 'prowlarr') {
    const [health, statuses] = await Promise.all([
      part('health', '/health'),
      part('indexer status', '/indexerstatus'),
    ])
    issues.push(...healthIssues(id, health))
    // Names cost a second call, so only ask when something is disabled.
    if (indexerIssues(statuses, [], now).length) {
      issues.push(
        ...indexerIssues(statuses, await part('indexers', '/indexer'), now),
      )
    }
    return snap
  }

  const unknown =
    id === 'radarr' ? 'includeUnknownMovieItems' : 'includeUnknownSeriesItems'
  const include =
    id === 'radarr'
      ? 'includeMovie=true'
      : 'includeSeries=true&includeEpisode=true'
  const from = encodeURIComponent(new Date(now - RECENT_WINDOW).toISOString())
  const to = encodeURIComponent(new Date(now + UPCOMING_WINDOW).toISOString())
  // The full movie or series list only every 15 minutes: it can be large.
  const cached = cache.library?.[id]
  const stale =
    !cached ||
    now - cached.at > LIBRARY_TTL ||
    // A cache from before the range map: fetch now, not in 15 minutes.
    (id === 'radarr' && !cached.ranges)
  const [health, queue, disks, roots, history, calendar, all] =
    await Promise.all([
      part('health', '/health'),
      part('queue', `/queue?page=1&pageSize=50&${unknown}=true&${include}`),
      part('disk space', '/diskspace'),
      part('root folders', '/rootfolder'),
      part(
        'history',
        `/history?page=1&pageSize=20&eventType=3&sortKey=date&sortDirection=descending&${include}`,
      ),
      part(
        'calendar',
        `/calendar?start=${from}&end=${to}${id === 'sonarr' ? '&includeSeries=true' : ''}`,
      ),
      stale
        ? part('library', id === 'radarr' ? '/movie' : '/series')
        : undefined,
    ])
  issues.push(...healthIssues(id, health), ...diskIssues(id, roots, disks))
  // Remember since when each record has been waiting to import.
  const since: Record<string, number> = {}
  for (const r of isRecord(queue) ? list(queue.records) : []) {
    if (!isImportPending(r)) continue
    const k = pendingKey(id, r)
    since[k] = cache.pending[k] ?? now
  }
  for (const k of Object.keys(cache.pending)) {
    if (k.startsWith(`${id}:`)) delete cache.pending[k]
  }
  Object.assign(cache.pending, since)
  snap.downloads = queueDownloads(id, queue, now, since)
  const cal = calendarItems(id, calendar, now)
  snap.upcoming = cal.upcoming
  issues.push(...cal.late)
  if (Array.isArray(all)) {
    cache.library = {
      ...cache.library,
      [id]: {
        count: libraryCount(id, all),
        at: now,
        ...(id === 'radarr' ? { ranges: movieRanges(all) } : {}),
      },
    }
  }
  snap.recent = recentImports(
    id,
    history,
    now,
    cache.library?.[id]?.ranges ?? {},
  )
  snap.library = cache.library?.[id]?.count
  snap.free = freeSpace(roots)
  return snap
}

async function pipeline(
  cache: Cache,
  now: number,
  deadline: AbortSignal,
): Promise<AppSnapshot> {
  const raw = (process.env.PIPELINE_STATUS_URL ?? '').trim()
  if (!raw) return { app: 'pipeline', state: 'unconfigured' }
  // The file's own path matters here, so keep everything but credentials.
  const url = normalizeUrl(raw)
  if (!url) {
    return {
      app: 'pipeline',
      state: 'misconfigured',
      reason: 'URL is not valid',
    }
  }
  const res = await getJson(url, null, deadline)
  if (!res.ok) {
    return {
      app: 'pipeline',
      state: 'down',
      url,
      reason: res.reason,
      lastOkAt: cache.apps.pipeline?.lastOkAt,
    }
  }
  return pipelineSnapshot(res.body, url, now)
}

async function tick(): Promise<WidgetView> {
  const now = Date.now()
  const cache = readCache()
  const deadline = AbortSignal.timeout(TICK_DEADLINE)
  const snaps = await Promise.all([
    ...ARRS.map((id) => arrSnapshot(id, cache, now, deadline)),
    pipeline(cache, now, deadline),
  ])
  for (const s of snaps) {
    if (s.state === 'up') cache.apps[s.app] = { lastOkAt: now }
  }
  if (snaps.some((s) => s.state !== 'unconfigured')) writeCache(cache)
  return toView(snaps, now)
}

if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === 'manifest') console.log(JSON.stringify(manifest()))
  else if (cmd === 'tick') {
    tick()
      .then((v) => console.log(JSON.stringify(v)))
      .catch((e) => {
        console.error(e instanceof Error ? e.message : String(e))
        process.exit(1)
      })
  } else {
    console.error('usage: arr.ts manifest|tick')
    process.exit(1)
  }
}
