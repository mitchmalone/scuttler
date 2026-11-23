// scuttler widget: health of a self-hosted *arr media stack (docs/WIDGETS.md).
//
// Radarr, Sonarr, Prowlarr and Bazarr, each optional: give an app a URL and an
// API key in Settings → Menubar → Custom widgets and it joins the card. The
// cell is a clapperboard: plain while all is well, accent while something
// downloads, amber with a count on warnings, a red triangle on errors. The
// card lists what needs attention (health issues, low disks, disabled
// indexers), then up to five downloads, then one row per app.
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
// between ticks is a small cache (when each app last answered, and since when
// a download has been waiting to import).
//
// Install: copy into ~/.config/scuttler/widgets/. Runs under Bun or Node.
import type {
  WidgetAction,
  WidgetRow,
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
}

export type Download = {
  app: AppId
  title: string
  /** 0–100; absent when the source reports no size. */
  progress?: number
  eta?: string
  level: 'ok' | 'warn' | 'error'
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
      version?: string
      issues: Issue[]
      downloads: Download[]
      missing?: number
      missingSubs?: { movies: number; episodes: number }
      /** Sonarr: episodes airing today. */
      airing?: number
      /** Pipeline: files waiting to be processed. */
      pending?: number
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
const SETTINGS_PATH = 'Settings → Menubar → Custom widgets'
const MAX_ROWS = 14
const MAX_DOWNLOADS = 5
const TITLE_CHARS = 48
const TEXT_CHARS = 90
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const GB = 1024 ** 3
const STALE_IMPORT = 30 * MINUTE
const PIPELINE_WINDOW = 7 * DAY
const REQUEST_TIMEOUT = 5000
const TICK_DEADLINE = 15_000
const PER_APP_CONCURRENCY = 4

const REASONS: Record<string, string> = {
  'no-forced-main-language': 'no forced English subtitles',
}

export function manifest() {
  const app = (id: ArrId, port: number) => [
    {
      key: `${id.toUpperCase()}_URL`,
      label: `${NAMES[id]} URL`,
      hint: `e.g. http://beebee:${port}`,
    },
    {
      key: `${id.toUpperCase()}_API_KEY`,
      label: `${NAMES[id]} API key`,
      hint: `${NAMES[id]} → Settings → General → Security (the API key, not your login)`,
      secret: true,
    },
  ]
  return {
    id: 'arr',
    name: 'Media stack',
    interval: 60,
    zone: 'right',
    icon: 'clapperboard',
    timeout: 20,
    settings: [
      ...app('radarr', 7878),
      ...app('sonarr', 8989),
      ...app('prowlarr', 9696),
      ...app('bazarr', 6767),
      {
        key: 'PIPELINE_STATUS_URL',
        label: 'Pipeline status URL (optional)',
        hint: 'a status.json describing post-processing',
      },
    ],
  }
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

function queueTitle(r: Record<string, unknown>): string {
  const movie = isRecord(r.movie) ? str(r.movie.title) : undefined
  if (movie) {
    const year = isRecord(r.movie) ? num(r.movie.year) : undefined
    return year ? `${movie} (${year})` : movie
  }
  const series = isRecord(r.series) ? str(r.series.title) : undefined
  if (series) {
    const ep = isRecord(r.episode) ? r.episode : {}
    const s = num(ep.seasonNumber)
    const e = num(ep.episodeNumber)
    const pad = (n: number) => String(n).padStart(2, '0')
    return s !== undefined && e !== undefined
      ? `${series} S${pad(s)}E${pad(e)}`
      : series
  }
  return str(r.title) ?? 'download'
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
          text: middle(basename(path)),
          hint: clip(REASONS[reason] ?? reason, 60),
        },
      ]
    })
  const queue = isRecord(body.queue) ? body.queue : {}
  const running = isRecord(queue.running) ? str(queue.running.path) : undefined
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
            title: `Converting ${basename(running)}`,
            level: 'ok',
          },
        ]
      : [],
    pending: num(queue.pending),
  }
}

/* ---- the view (pure) ------------------------------------------------- */

const RANK = { error: 0, warn: 1, ok: 2 } as const
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const open = (value: string | undefined): WidgetAction | null =>
  value ? { type: 'open', value } : null

function appRow(snap: AppSnapshot, now: number): WidgetRow | null {
  const name = NAMES[snap.app]
  switch (snap.state) {
    case 'unconfigured':
      return null
    case 'misconfigured':
      return { dot: 'muted', text: name, hint: snap.reason }
    case 'auth':
      return {
        dot: 'error',
        text: name,
        hint: snap.reason,
        action: open(snap.url),
      }
    case 'down':
      return {
        dot: 'error',
        text: name,
        hint:
          snap.lastOkAt !== undefined
            ? `${snap.reason} · ok ${now - snap.lastOkAt < MINUTE ? 'just now' : `${span(now - snap.lastOkAt)} ago`}`
            : snap.reason,
        action: open(snap.url),
      }
    case 'up': {
      const extras: string[] = []
      if (snap.missing) extras.push(`${snap.missing} missing`)
      if (snap.airing) extras.push(`${snap.airing} airing today`)
      const subs = snap.missingSubs
      if (subs && subs.movies + subs.episodes > 0) {
        const parts = [
          subs.movies ? plural(subs.movies, 'movie') : null,
          subs.episodes ? plural(subs.episodes, 'episode') : null,
        ].filter(Boolean)
        extras.push(`${parts.join(', ')} without subs`)
      }
      const hint =
        snap.app === 'pipeline'
          ? snap.pending
            ? `${snap.pending} pending`
            : 'idle'
          : (snap.version ?? null)
      return {
        dot: 'ok',
        text: [name, ...extras].join(' · '),
        hint,
        action: open(snap.url),
      }
    }
  }
}

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
  for (const s of configured) {
    const name = NAMES[s.app]
    if (s.state !== 'misconfigured' && s.state !== 'unconfigured') {
      urls.set(s.app, s.url)
    }
    if (s.state === 'misconfigured') {
      issues.push({ app: s.app, level: 'warn', text: `${name}: ${s.reason}` })
    } else if (s.state === 'down') {
      issues.push({
        app: s.app,
        level: 'error',
        text:
          s.app === 'pipeline'
            ? 'Pipeline status unreachable'
            : `${name} unreachable`,
      })
    } else if (s.state === 'auth') {
      issues.push({
        app: s.app,
        level: 'error',
        text: `${name} rejected the API key`,
      })
    } else if (s.state === 'up') {
      issues.push(...s.issues)
      downloads.push(...s.downloads)
    }
  }
  issues.sort((a, b) => RANK[a.level] - RANK[b.level])
  downloads.sort(
    (a, b) =>
      RANK[a.level] - RANK[b.level] || (b.progress ?? 0) - (a.progress ?? 0),
  )

  const bad = downloads.filter((d) => d.level !== 'ok')
  const active = downloads.length - bad.length
  const problems = issues.length + bad.length
  const anyError = [...issues, ...bad].some((p) => p.level === 'error')

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

  // App rows always stay; the 14-row cap falls on issues, then downloads.
  const apps = configured
    .map((s) => appRow(s, now))
    .filter((r): r is WidgetRow => r !== null)
  const room = Math.max(0, MAX_ROWS - apps.length)
  const shownIssues = issues.slice(0, room)
  const shownDownloads = downloads.slice(
    0,
    Math.min(MAX_DOWNLOADS, room - shownIssues.length),
  )
  const more =
    issues.length -
    shownIssues.length +
    (downloads.length - shownDownloads.length)

  const rows: WidgetRow[] = [
    ...shownIssues.map((i) => ({
      dot: i.level,
      text: i.text,
      hint: i.hint ?? NAMES[i.app],
      action: open(i.link ?? urls.get(i.app)),
    })),
    ...shownDownloads.map((d) => {
      const base = urls.get(d.app)
      const progress = [
        d.progress !== undefined ? `${d.progress}%` : null,
        d.eta ?? null,
      ].filter(Boolean)
      return {
        dot: (d.level === 'ok' ? 'accent' : d.level) satisfies WidgetTone,
        text: middle(d.title),
        hint:
          d.level === 'ok' ? progress.join(' · ') || null : (d.note ?? null),
        action: open(
          base && d.app !== 'pipeline' ? `${base}/activity/queue` : base,
        ),
      }
    }),
    ...apps,
  ]

  const subtitle = [
    problems ? plural(problems, 'issue') : null,
    active ? `${active} downloading` : null,
  ].filter(Boolean)
  return {
    icon: anyError ? 'triangle-alert' : 'clapperboard',
    label: problems ? String(problems) : active ? String(active) : null,
    tone: anyError
      ? 'error'
      : problems
        ? 'warn'
        : downloads.length
          ? 'accent'
          : 'ok',
    click: open(target ? urls.get(target) : undefined),
    card: {
      title: 'Media stack',
      subtitle: subtitle.join(' · ') || 'all good',
      rows,
      hint: more > 0 ? `+${more} more` : null,
    },
  }
}

/* ---- I/O ------------------------------------------------------------- */

type Cache = {
  apps: Partial<Record<AppId, { lastOkAt: number }>>
  /** `pendingKey` → epoch ms first seen waiting to import. */
  pending: Record<string, number>
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
  const rawUrl = (process.env[`${id.toUpperCase()}_URL`] ?? '').trim()
  const key = (process.env[`${id.toUpperCase()}_API_KEY`] ?? '').trim()
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

function today(now: number): { start: string; end: string } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + DAY).toISOString(),
  }
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
  const info =
    id === 'bazarr' && isRecord(status.body) ? status.body.data : status.body
  const version = isRecord(info)
    ? str(id === 'bazarr' ? info.bazarr_version : info.version)
    : undefined

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
    version,
    issues,
    downloads: [],
  }

  if (id === 'bazarr') {
    const [health, badges] = await Promise.all([
      part('health', '/system/health'),
      part('badges', '/badges'),
    ])
    issues.push(...healthIssues(id, health))
    if (isRecord(badges)) {
      snap.missingSubs = {
        movies: num(badges.movies) ?? 0,
        episodes: num(badges.episodes) ?? 0,
      }
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
  const day = today(now)
  const [health, queue, missing, disks, roots, calendar] = await Promise.all([
    part('health', '/health'),
    part('queue', `/queue?page=1&pageSize=50&${unknown}=true&${include}`),
    part('missing', '/wanted/missing?page=1&pageSize=1&monitored=true'),
    part('disk space', '/diskspace'),
    part('root folders', '/rootfolder'),
    id === 'sonarr'
      ? part(
          'calendar',
          `/calendar?start=${encodeURIComponent(day.start)}&end=${encodeURIComponent(day.end)}`,
        )
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
  if (isRecord(missing)) snap.missing = num(missing.totalRecords)
  if (Array.isArray(calendar)) snap.airing = calendar.length
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
