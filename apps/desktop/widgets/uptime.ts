// scuttler widget: the monitors on an Uptime Kuma status page (docs/WIDGETS.md).
//
// Reads a public Uptime Kuma status page: `/api/status-page/<slug>` for the
// groups and monitors, `/api/status-page/heartbeat/<slug>` for each monitor's
// latest beat and 24 h uptime. Paints an up/down arrow with the count of
// monitors that are down. The card lists every monitor with a dot, its 24 h
// uptime and its latest ping; a row opens the monitored site when the page
// shares its URL, the cell opens the status page.
//
// Set UPTIME_KUMA_URL to the status page's address, e.g.
// `https://kuma.example:3001/status/home`. A bare origin means the page whose
// slug is `default`.
//
// Install: copy into ~/.config/scuttler/widgets/ (or Settings → Widgets →
// add file). Runs under Bun; the type import is erased.
import type { WidgetRow, WidgetTone, WidgetView } from '@scuttler/tui/bar/types'

const MAX_ROWS = 14

/** A monitor on the page (`publicGroupList[].monitorList[]`). */
export type KumaMonitor = {
  id?: number
  name?: string
  /** Present only when the page shares monitor URLs. */
  url?: string
}
export type KumaGroup = { name?: string; monitorList?: KumaMonitor[] }
export type KumaPage = { publicGroupList?: KumaGroup[] }
/** 0 down · 1 up · 2 pending · 3 maintenance. */
export type KumaBeat = { status?: number; ping?: number | null }
export type KumaHeartbeats = {
  /** Monitor id → beats, oldest first. */
  heartbeatList?: Record<string, KumaBeat[]>
  /** `<monitor id>_24` → uptime over 24 h, 0 to 1. */
  uptimeList?: Record<string, number>
}

export function manifest() {
  return {
    id: 'uptime',
    name: 'Uptime',
    interval: 120,
    zone: 'right',
    icon: 'arrow-big-up',
    timeout: 15,
    settings: [
      {
        key: 'UPTIME_KUMA_URL',
        label: 'Uptime Kuma status page',
        hint: 'its address, e.g. https://kuma.example:3001/status/home',
        required: true,
      },
    ],
  }
}

/** The status page's address → the API origin, its slug and the page to open. */
export function parsePage(
  raw: string | undefined,
): { origin: string; slug: string; page: string } | null {
  try {
    const url = new URL((raw ?? '').trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const slug = /^\/status\/([^/]+)/.exec(url.pathname)?.[1] ?? 'default'
    return { origin: url.origin, slug, page: `${url.origin}/status/${slug}` }
  } catch {
    return null
  }
}

const STATE: Record<number, { dot: WidgetTone; word: string | null }> = {
  0: { dot: 'error', word: 'down' },
  1: { dot: 'ok', word: null },
  2: { dot: 'warn', word: 'pending' },
  3: { dot: 'muted', word: 'maintenance' },
}

/** '100%' / '99.9%' / '98.25%': never rounds a miss up to 100. */
export function uptimePct(ratio: number | undefined): string | null {
  if (typeof ratio !== 'number' || Number.isNaN(ratio)) return null
  if (ratio >= 1) return '100%'
  const pct = Math.min(99.99, Math.floor(ratio * 10000) / 100)
  return `${pct.toFixed(pct >= 99.9 ? 2 : 1)}%`
}

/** The view for one page and its heartbeats — pure, so it's testable. */
export function view(
  page: KumaPage,
  beats: KumaHeartbeats,
  statusPage: string,
): WidgetView {
  const groups = (page.publicGroupList ?? []).filter(
    (g) => g.monitorList?.length,
  )
  let down = 0
  let total = 0
  let shown = 0
  const rowsFor = (monitors: KumaMonitor[]): WidgetRow[] =>
    monitors.flatMap((m) => {
      total += 1
      const last = beats.heartbeatList?.[String(m.id)]?.at(-1)
      const state = STATE[last?.status ?? -1]
      if (last?.status === 0) down += 1
      if (shown >= MAX_ROWS) return []
      shown += 1
      const ping =
        state?.dot === 'ok' && typeof last?.ping === 'number'
          ? `${Math.round(last.ping)} ms`
          : null
      const hint = [
        state ? state.word : 'no data',
        uptimePct(beats.uptimeList?.[`${m.id}_24`]),
        ping,
      ]
        .filter(Boolean)
        .join(' · ')
      return [
        {
          dot: state?.dot ?? 'muted',
          text: m.name ?? 'monitor',
          hint: hint || null,
          action: { type: 'open' as const, value: m.url || statusPage },
        },
      ]
    })
  const sections = groups.map((g) => ({
    title: g.name ?? '',
    rows: rowsFor(g.monitorList ?? []),
  }))
  const hidden = total - shown
  return {
    icon: down ? 'arrow-big-down' : 'arrow-big-up',
    label: down ? String(down) : null,
    tone: down ? 'error' : 'ok',
    click: { type: 'open', value: statusPage },
    card: {
      title: 'Uptime',
      subtitle: !total
        ? 'no monitors on the page'
        : down
          ? `${down} of ${total} down`
          : `all ${total} up`,
      // One group reads as a plain list; several keep their names.
      ...(sections.length === 1
        ? { rows: sections[0]!.rows }
        : { sections: sections.filter((s) => s.rows.length) }),
      hint:
        (hidden > 0 ? `${hidden} more not shown · ` : '') +
        'uptime is over 24 h · cell opens the status page',
    },
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'scuttler-widget', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`uptime kuma ${res.status} on ${url}`)
  return (await res.json()) as T
}

async function tick(): Promise<WidgetView> {
  const at = parsePage(process.env.UPTIME_KUMA_URL)
  if (!at) {
    return {
      setup: {
        message: 'UPTIME_KUMA_URL is not a status page address',
        fix: 'Settings → Widgets → Uptime',
      },
    }
  }
  const [page, beats] = await Promise.all([
    get<KumaPage>(`${at.origin}/api/status-page/${at.slug}`),
    get<KumaHeartbeats>(`${at.origin}/api/status-page/heartbeat/${at.slug}`),
  ])
  return view(page, beats, at.page)
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
    console.error('usage: uptime.ts manifest|tick')
    process.exit(1)
  }
}
