// scuttler widget: latest Vercel deployment per project (docs/WIDGETS.md).
//
// The reference widget for the **stored-token** half of widget settings:
// `VERCEL_TOKEN` (a personal token from vercel.com/account/tokens, pasted into
// Settings → Widgets, kept in the Keychain) arrives as env on
// every tick; the team is the Vercel CLI's current one (or VERCEL_TEAM_ID in
// the environment). Without a token the widget falls back to what the CLI
// stores (`vercel login`). That token lives eight hours and only a CLI run
// renews it, so when it has expired the widget runs `vercel whoami` through
// the login shell and reads the store again: the CLI refreshes its own login,
// the widget never touches the refresh token (JOURNAL 2026-11-25). One `GET /v9/projects` per tick: each project's
// latest production deployment becomes a row; the cell is the Vercel triangle,
// dashed and red while any deployment has failed, amber while one is building.
// With no token from anywhere, or a CLI login the CLI itself can't renew, the
// cell goes dim with the fix in the card and in Settings, never silently blank
// (Mitch, 2026-08-20).
//
// Install: copy into ~/.config/scuttler/widgets/. Runs under Bun.
import type { WidgetTone, WidgetView } from '@scuttler/tui/bar/types'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Thrown when the fix is the user's, not the widget's — becomes `setup`. */
export class SetupNeeded extends Error {
  fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

const API = 'https://api.vercel.com'
// The CLI's store moved: older CLIs used Application Support; 61 writes the
// XDG data dir and leaves the old file to rot (JOURNAL 2026-10-01). Read both
// and trust whichever token expires last.
const CLI_DIRS = [
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'),
    'com.vercel.cli',
  ),
  join(homedir(), 'Library/Application Support/com.vercel.cli'),
]
const MAX_ROWS = 12
/** Renew this long before the CLI token's expiry, so a tick never races it. */
const RENEW_MARGIN_MS = 60_000
const RENEW_TIMEOUT_MS = 8000

const TONES: Record<string, WidgetTone> = {
  READY: 'ok',
  ERROR: 'error',
  CANCELED: 'muted',
  BUILDING: 'warn',
  QUEUED: 'warn',
  INITIALIZING: 'warn',
}

export type Deployment = {
  id?: string
  url?: string
  readyState?: string
  createdAt?: number
  target?: string | null
  alias?: string[]
}

export type Project = { name: string; latestDeployments?: Deployment[] }

export function manifest() {
  return {
    id: 'vercel',
    name: 'Vercel',
    interval: 120,
    zone: 'right',
    icon: 'triangle',
    timeout: 20,
    settings: [
      {
        key: 'VERCEL_TOKEN',
        label: 'Vercel',
        hint: 'optional — a token to use instead of the Vercel CLI login',
        secret: true,
      },
    ],
    requires: [
      {
        label: 'Vercel CLI, signed in (or a pasted token)',
        fix: 'vercel login',
      },
    ],
  }
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type Credentials = {
  token: string | null
  team: string | null
  /** True when the token is the CLI's own, which the CLI can renew. */
  cli: boolean
  /** Epoch seconds the CLI token expires at; null when unknown or pasted. */
  expiresAt: number | null
}

/** Token + team from the env, else the Vercel CLI's own store. */
function credentials(): Credentials {
  const stores = CLI_DIRS.map((dir) => ({
    auth: readJson(join(dir, 'auth.json')),
    cfg: readJson(join(dir, 'config.json')),
  })).filter((s) => typeof s.auth.token === 'string')
  const expiry = (s: (typeof stores)[number]) =>
    typeof s.auth.expiresAt === 'number' ? s.auth.expiresAt : 0
  const { auth, cfg } = stores.reduce<{
    auth: Record<string, unknown>
    cfg: Record<string, unknown>
  }>((a, b) => (!a.auth.token || expiry(b) > expiry(a) ? b : a), {
    auth: {},
    cfg: {},
  })
  const pasted = process.env.VERCEL_TOKEN
  const token = pasted ?? (auth.token as string | undefined)
  const team =
    process.env.VERCEL_TEAM_ID ?? (cfg.currentTeam as string | undefined)
  return {
    token: token ?? null,
    team: team ?? null,
    cli: !pasted && typeof auth.token === 'string',
    expiresAt:
      !pasted && typeof auth.expiresAt === 'number' ? auth.expiresAt : null,
  }
}

/**
 * Let the Vercel CLI renew its own login: any command that needs the account
 * refreshes an expired token. Through the login shell, because scuttler's
 * PATH is bare and the CLI is usually a node shim behind a version manager.
 * Never throws; the caller reads the store again and judges by the token.
 */
async function renewCli(): Promise<void> {
  try {
    const proc = Bun.spawn(
      [process.env.SHELL ?? '/bin/zsh', '-lic', 'vercel whoami'],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
    )
    const timer = setTimeout(() => proc.kill(), RENEW_TIMEOUT_MS)
    await proc.exited
    clearTimeout(timer)
  } catch {
    // no shell or no CLI: the store is unchanged and the caller says so
  }
}

/**
 * Run `load` with credentials, renewing a CLI login once when it has expired
 * or the API rejects it. Pure over its three inputs, so it's testable.
 */
export async function withRenewal<T>(
  read: () => Credentials,
  renew: () => Promise<void>,
  load: (creds: Credentials) => Promise<T>,
  now = Date.now(),
): Promise<T> {
  let creds = read()
  let renewed = false
  const tryRenew = async (): Promise<boolean> => {
    if (renewed || !creds.cli) return false
    renewed = true
    const before = creds.token
    await renew()
    creds = read()
    return creds.token !== before
  }
  const expired =
    creds.expiresAt !== null && creds.expiresAt * 1000 <= now + RENEW_MARGIN_MS
  if (expired && !(await tryRenew())) throw unrenewable()
  try {
    return await load(creds)
  } catch (e) {
    if (!(e instanceof SetupNeeded) || !creds.cli) throw e
    if (renewed || !(await tryRenew())) throw unrenewable()
    return await load(creds)
  }
}

/** The CLI login is dead and the CLI couldn't renew it: sign in again. */
function unrenewable(): SetupNeeded {
  return new SetupNeeded(
    'the Vercel CLI login expired and the CLI could not renew it',
    'vercel login',
  )
}

async function get<T>(
  path: string,
  token: string,
  params: Record<string, string | null> = {},
): Promise<T> {
  const url = new URL(API + path)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'scuttler-widget',
    },
    signal: AbortSignal.timeout(12000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new SetupNeeded(
      `Vercel rejected the token (${res.status}) — set a new one in Settings`,
      'vercel login',
    )
  }
  if (!res.ok) throw new Error(`vercel api ${res.status} on ${path}`)
  return (await res.json()) as T
}

/** '3m' / '2h' / '4d' since an epoch-ms timestamp, or null. */
export function age(ms: number | undefined, now = Date.now()): string | null {
  if (typeof ms !== 'number') return null
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** The view for one project list — pure, so it's testable. */
export function view(
  projects: Project[],
  slug: string | null,
  now = Date.now(),
): WidgetView {
  const rows: {
    sort: number
    row: NonNullable<NonNullable<WidgetView['card']>['rows']>[number]
  }[] = []
  const states: string[] = []
  for (const p of projects) {
    const deps = p.latestDeployments ?? []
    const prod = deps.filter((d) => d.target === 'production')
    const pool = prod.length ? prod : deps
    if (!pool.length) continue
    const d = pool.reduce((a, b) =>
      (b.createdAt ?? 0) > (a.createdAt ?? 0) ? b : a,
    )
    const state = (d.readyState ?? '').toUpperCase()
    states.push(state)
    const aliases = d.alias ?? []
    const domain =
      aliases.find((a) => !a.endsWith('.vercel.app')) ?? aliases[0] ?? d.url
    const dpl = (d.id ?? '').replace(/^dpl_/, '')
    const url =
      slug && dpl
        ? `https://vercel.com/${slug}/${p.name}/${dpl}`
        : `https://vercel.com/${slug ?? ''}/${p.name}`
    rows.push({
      sort: d.createdAt ?? 0,
      row: {
        dot: TONES[state] ?? 'muted',
        text: domain ? `${p.name} → ${domain}` : p.name,
        hint: age(d.createdAt, now),
        action: { type: 'open', value: url },
      },
    })
  }
  rows.sort((a, b) => b.sort - a.sort)
  const failed = states.filter((s) => s === 'ERROR').length
  const building = states.some((s) => TONES[s] === 'warn')
  return {
    icon: failed ? 'triangle-dashed' : 'triangle',
    label: failed ? String(failed) : null,
    tone: failed ? 'error' : building ? 'warn' : 'ok',
    click: {
      type: 'open',
      value: slug ? `https://vercel.com/${slug}` : 'https://vercel.com',
    },
    card: {
      title: 'Vercel',
      subtitle: failed
        ? `${failed} failed`
        : building
          ? 'deploying…'
          : `${rows.length} projects ready`,
      rows: rows.slice(0, MAX_ROWS).map((r) => r.row),
      hint: 'click a project to open the deployment',
    },
  }
}

async function load({ token, team }: Credentials): Promise<WidgetView> {
  if (!token) {
    return {
      setup: {
        message: 'no Vercel credentials — sign in with the Vercel CLI',
        fix: 'vercel login',
      },
    }
  }
  const slug = team
    ? (await get<{ slug?: string }>(`/v2/teams/${team}`, token)).slug
    : (await get<{ user?: { username?: string } }>('/v2/user', token)).user
        ?.username
  const { projects } = await get<{ projects: Project[] }>(
    '/v9/projects',
    token,
    { teamId: team, limit: '100' },
  )
  return view(projects ?? [], slug ?? null)
}

const tick = (): Promise<WidgetView> => withRenewal(credentials, renewCli, load)

if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === 'manifest') console.log(JSON.stringify(manifest()))
  else if (cmd === 'tick') {
    tick()
      .then((v) => console.log(JSON.stringify(v)))
      .catch((e) => {
        if (e instanceof SetupNeeded) {
          console.log(
            JSON.stringify({ setup: { message: e.message, fix: e.fix } }),
          )
          return
        }
        console.error(e instanceof Error ? e.message : String(e))
        process.exit(1)
      })
  } else {
    console.error('usage: vercel.ts manifest|tick')
    process.exit(1)
  }
}
