// scuttler widget: every place your jobs run, one cell (docs/WIDGETS.md).
//
// The services are the user's: added and configured in Settings → Widgets →
// Jobs, delivered on every tick as SCUTTLER_SERVICES (a JSON array of
// { id, type, label, settings }), complete ones only (DECISIONS 2026-11-27).
// Three types for now:
//
// - github: the latest run of every active workflow in the repos you pushed
//   to most recently, plus pinned ones. Credentials piggyback on the GitHub
//   CLI (`gh auth token`) unless a token is pasted.
// - dagu: the latest run of each DAG on a Dagu server (`/api/v1/dags`, an API
//   key as a bearer token). Suspended DAGs, DAGs that never ran and the ones
//   listed in Hide are left out.
// - vercel: the latest production deployment of each project. The Vercel
//   CLI's login unless a token is pasted; an expired CLI login is renewed by
//   the CLI itself (`vercel whoami`), never by this widget.
//
// The card has one section per service, every row in each, failing first,
// then running, then newest. One service failing to load is a grey row in
// its own section; the others still render. The cell is `activity`, red with
// the failing count across every service, amber while anything runs.
//
// Install: copy into ~/.config/scuttler/widgets/. Runs under Bun.
import type {
  WidgetRow,
  WidgetSection,
  WidgetTone,
  WidgetView,
} from '@scuttler/tui/bar/types'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Thrown when the fix is the user's (a rejected key): its section says so. */
export class SetupNeeded extends Error {
  fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

/** One service as Settings delivers it. */
export type Service = {
  id: string
  type: string
  label: string
  settings: Record<string, string>
}

/** One row before it's ranked: `tone` decides the order and the counts. */
export type Item = {
  text: string
  tone: WidgetTone
  /** ISO-8601 or epoch ms; the hint is its age. */
  at: string | number | null
  url: string | null
  /** Shown instead of the age (e.g. "running"). */
  hint?: string | null
}

/** What one service read: its rows, or why it couldn't. */
export type Read = { service: Service; items: Item[]; error?: string }

const FETCH_TIMEOUT_MS = 12000
const UA = 'scuttler-widget'

// ---- the manifest -------------------------------------------------------

export function manifest() {
  return {
    id: 'jobs',
    name: 'Jobs',
    interval: 120,
    zone: 'right',
    icon: 'activity',
    timeout: 30,
    settings: [],
    services: [
      {
        type: 'github',
        name: 'GitHub Actions',
        icon: 'git-branch',
        settings: [
          {
            key: 'GITHUB_TOKEN',
            label: 'Token',
            hint: 'optional: used instead of the GitHub CLI login',
            secret: true,
          },
          {
            key: 'GITHUB_REPOS',
            label: 'Pinned repos',
            hint: 'owner/repo, comma separated: watched on top of your 10 most recently pushed',
          },
        ],
        requires: [
          {
            label: 'GitHub CLI, signed in (or a pasted token)',
            fix: 'brew install gh && gh auth login',
          },
        ],
      },
      {
        type: 'dagu',
        name: 'Dagu',
        icon: 'workflow',
        settings: [
          {
            key: 'DAGU_URL',
            label: 'URL',
            hint: 'the Dagu server, e.g. https://nas.example.ts.net:8443',
            required: true,
          },
          {
            key: 'DAGU_TOKEN',
            label: 'API key',
            hint: 'Dagu → API Keys: viewer role, REST API only',
            secret: true,
            required: true,
          },
          {
            key: 'DAGU_HIDE',
            label: 'Hide',
            hint: 'DAG names to leave out, comma separated',
          },
        ],
        requires: [],
      },
      {
        type: 'vercel',
        name: 'Vercel',
        icon: 'triangle',
        settings: [
          {
            key: 'VERCEL_TOKEN',
            label: 'Token',
            hint: 'optional: used instead of the Vercel CLI login',
            secret: true,
          },
          {
            key: 'VERCEL_TEAM_ID',
            label: 'Team',
            hint: "optional: a team id; the CLI's current team when empty",
          },
        ],
        requires: [
          {
            label: 'Vercel CLI, signed in (or a pasted token)',
            fix: 'vercel login',
          },
        ],
      },
    ],
    requires: [],
  }
}

// ---- shared -------------------------------------------------------------

/** '3m' / '2h' / '4d' since an ISO-8601 string or epoch ms, or null. */
export function age(
  at: string | number | null | undefined,
  now = Date.now(),
): string | null {
  if (at == null || at === '') return null
  const t = typeof at === 'number' ? at : Date.parse(at)
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** `a, b c` → trimmed, deduped, empties dropped. */
export function parseList(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

/** `owner/repo,owner/repo` → the well-formed ones, deduped. */
export function parseRepos(raw: string | undefined): string[] {
  return parseList(raw).filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s))
}

/** SCUTTLER_SERVICES, defensively: anything malformed is dropped. */
export function parseServices(raw: string | undefined): Service[] {
  let data: unknown
  try {
    data = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data.flatMap((s): Service[] => {
    if (!s || typeof s !== 'object') return []
    const o = s as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.type !== 'string') return []
    const settings: Record<string, string> = {}
    if (o.settings && typeof o.settings === 'object') {
      for (const [k, v] of Object.entries(o.settings)) {
        if (typeof v === 'string') settings[k] = v
      }
    }
    return [
      {
        id: o.id,
        type: o.type,
        label: typeof o.label === 'string' && o.label ? o.label : o.type,
        settings,
      },
    ]
  })
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  onAuth: (status: number) => Error,
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 401 || res.status === 403) throw onAuth(res.status)
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return (await res.json()) as T
}

// ---- the view -----------------------------------------------------------

const RANK: Partial<Record<WidgetTone, number>> = { error: 0, warn: 1 }
const rank = (i: Item) => RANK[i.tone] ?? 2
const stamp = (i: Item) =>
  i.at == null ? 0 : typeof i.at === 'number' ? i.at : Date.parse(i.at) || 0

/** Failing first, then running, then the rest; newest first within each. */
export function ranked(items: Item[]): Item[] {
  return [...items].sort((a, b) => rank(a) - rank(b) || stamp(b) - stamp(a))
}

/** The view for every service's read — pure, so it's testable. */
export function view(reads: Read[], now = Date.now()): WidgetView {
  if (!reads.length) {
    return {
      icon: 'activity',
      label: null,
      tone: 'muted',
      click: { type: 'settings', value: 'widgets' },
      card: {
        title: 'Jobs',
        subtitle: 'no services',
        rows: [
          {
            dot: 'muted',
            text: 'add a service in Settings → Widgets → Jobs',
            action: { type: 'settings', value: 'widgets' },
          },
        ],
      },
    }
  }
  let failing = 0
  let running = 0
  let ok = 0
  const sections: WidgetSection[] = reads.map(({ service, items, error }) => {
    const rows: WidgetRow[] = ranked(items).map((i) => ({
      dot: i.tone,
      text: i.text,
      hint: i.hint ?? age(i.at, now),
      action: i.url ? { type: 'open', value: i.url } : null,
    }))
    const bad = items.filter((i) => i.tone === 'error').length
    failing += bad
    running += items.filter((i) => i.tone === 'warn').length
    ok += items.filter((i) => i.tone === 'ok').length
    if (error) rows.unshift({ dot: 'muted', text: error })
    if (!rows.length) rows.push({ dot: 'muted', text: 'nothing has run yet' })
    return {
      title: bad ? `${service.label} · ${bad} failing` : service.label,
      rows,
    }
  })
  const counts = [
    failing ? `${failing} failing` : null,
    running ? `${running} running` : null,
    ok ? `${ok} ok` : null,
  ].filter(Boolean)
  return {
    icon: 'activity',
    label: failing ? String(failing) : null,
    tone: failing ? 'error' : running ? 'warn' : 'ok',
    click: { type: 'settings', value: 'widgets' },
    card: {
      title: 'Jobs',
      subtitle: counts.length ? counts.join(' · ') : 'nothing has run yet',
      sections,
      hint: 'click a row to open it',
    },
  }
}

// ---- github -------------------------------------------------------------

const GH_API = 'https://api.github.com'
const GH_RECENT = 10
const GH_RUNS_PER_REPO = 100

const GH_TONES: Record<string, WidgetTone> = {
  success: 'ok',
  failure: 'error',
  cancelled: 'error',
  timed_out: 'error',
  action_required: 'error',
  startup_failure: 'error',
  queued: 'warn',
  waiting: 'warn',
  pending: 'warn',
  requested: 'warn',
  in_progress: 'warn',
}

export type WorkflowRun = {
  workflow_id?: number
  repository?: { full_name?: string }
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  created_at?: string
}

export type Workflow = { id?: number; state?: string }

/** One workflow's latest run. */
export type RunItem = {
  repo: string
  workflow: string
  /** `conclusion` once completed, else `status` (queued, in_progress, …). */
  state: string
  url: string
  createdAt: string
}

/** Ids of the workflows GitHub will still run. */
export function activeWorkflows(workflows: Workflow[]): Set<number> {
  return new Set(
    workflows
      .filter((w) => w.state === 'active' && w.id != null)
      .map((w) => w.id as number),
  )
}

/** Ids of the active workflows that have no run in `runs`. */
export function missingWorkflows(
  workflows: Workflow[],
  runs: WorkflowRun[],
): number[] {
  const seen = new Set(runs.map((r) => r.workflow_id))
  return [...activeWorkflows(workflows)].filter((id) => !seen.has(id))
}

/**
 * The latest run of each workflow in one repo. `runs` is GitHub's list,
 * newest first, so the first run seen per workflow is its latest. With
 * `active`, runs of any other workflow (disabled, deleted) are dropped. The
 * repo is named as GitHub names it now, so an old pinned name and the new one
 * come out the same.
 */
export function latestPerWorkflow(
  repo: string,
  runs: WorkflowRun[],
  active?: Set<number>,
): RunItem[] {
  const seen = new Set<string>()
  const out: RunItem[] = []
  for (const run of runs) {
    if (active && (run.workflow_id == null || !active.has(run.workflow_id)))
      continue
    const key = String(run.workflow_id ?? run.name ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    const name = run.repository?.full_name ?? repo
    out.push({
      repo: name,
      workflow: run.name ?? 'workflow',
      state:
        run.status === 'completed'
          ? (run.conclusion ?? 'unknown')
          : (run.status ?? 'unknown'),
      url: run.html_url ?? `https://github.com/${name}/actions`,
      createdAt: run.created_at ?? '',
    })
  }
  return out
}

/** One row per run: two names for one repo read the same runs. */
export function dedupeRuns(items: RunItem[]): RunItem[] {
  const seen = new Set<string>()
  return items.filter((i) => {
    const key = `${i.repo}\n${i.workflow}\n${i.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Runs as rows: the owner dropped, since the workflow is what truncates. */
export function githubItems(runs: RunItem[]): Item[] {
  return dedupeRuns(runs).map((r) => ({
    text: `${r.repo.split('/').pop()} · ${r.workflow}`,
    tone: GH_TONES[r.state] ?? 'muted',
    at: r.createdAt || null,
    url: r.url,
  }))
}

/**
 * The GitHub CLI's token — gh refreshes its own credential store. Launched
 * from Finder, scuttler's PATH is bare, so the usual homes are probed too.
 */
async function ghCliToken(): Promise<string | null> {
  for (const gh of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    try {
      const proc = Bun.spawn([gh, 'auth', 'token'], {
        stdout: 'pipe',
        stderr: 'ignore',
      })
      const out = await new Response(proc.stdout).text()
      if ((await proc.exited) === 0 && out.trim()) return out.trim()
    } catch {
      // not at this path — try the next
    }
  }
  return null
}

async function readGithub(service: Service): Promise<Item[]> {
  const token = service.settings.GITHUB_TOKEN || (await ghCliToken())
  if (!token) {
    throw new SetupNeeded(
      'no GitHub credentials: sign in with the GitHub CLI',
      'gh auth login',
    )
  }
  const gh = <T>(path: string) =>
    getJson<T>(
      GH_API + path,
      {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      () =>
        new SetupNeeded(
          'GitHub rejected the credentials: sign in again',
          'gh auth login',
        ),
    )
  const mine = await gh<{ full_name: string }[]>(
    `/user/repos?sort=pushed&per_page=${GH_RECENT}&affiliation=owner,collaborator,organization_member`,
  )
  const repos = [
    ...new Set([
      ...parseRepos(service.settings.GITHUB_REPOS),
      ...mine.map((r) => r.full_name),
    ]),
  ]
  const runs = (
    await Promise.all(
      repos.map(async (repo): Promise<RunItem[]> => {
        try {
          const [{ workflow_runs }, { workflows }] = await Promise.all([
            gh<{ workflow_runs: WorkflowRun[] }>(
              `/repos/${repo}/actions/runs?per_page=${GH_RUNS_PER_REPO}`,
            ),
            gh<{ workflows: Workflow[] }>(
              `/repos/${repo}/actions/workflows?per_page=100`,
            ),
          ])
          const list = workflow_runs ?? []
          // A full page can leave out a workflow that last ran long ago
          // behind busier ones; ask for those directly.
          if (list.length === GH_RUNS_PER_REPO) {
            const rest = await Promise.all(
              missingWorkflows(workflows ?? [], list).map((id) =>
                gh<{ workflow_runs: WorkflowRun[] }>(
                  `/repos/${repo}/actions/workflows/${id}/runs?per_page=1`,
                ).then((r) => r.workflow_runs?.[0]),
              ),
            )
            list.push(...rest.filter((r): r is WorkflowRun => r != null))
          }
          return latestPerWorkflow(repo, list, activeWorkflows(workflows ?? []))
        } catch (e) {
          if (e instanceof SetupNeeded) throw e
          // One unreachable repo (renamed, no access) is a grey row.
          return [
            {
              repo,
              workflow: 'could not read runs',
              state: 'unknown',
              url: `https://github.com/${repo}/actions`,
              createdAt: '',
            },
          ]
        }
      }),
    )
  ).flat()
  return githubItems(runs)
}

// ---- dagu ---------------------------------------------------------------

/** Dagu's run status codes (api/v1, 2.27). */
const DAGU_TONES: Record<number, WidgetTone> = {
  1: 'warn', // running
  2: 'error', // failed
  3: 'error', // aborted
  4: 'ok', // succeeded
  5: 'warn', // queued
  6: 'error', // partially succeeded: some step failed
  7: 'warn', // waiting
  8: 'error', // rejected
}
const DAGU_ACTIVE = new Set([1, 5, 7])

export type DaguDag = {
  fileName?: string
  suspended?: boolean
  dag?: { name?: string }
  latestDAGRun?: {
    dagRunId?: string
    name?: string
    status?: number
    statusLabel?: string
    startedAt?: string
    finishedAt?: string
  }
}

/** The server's base URL, without a trailing slash. */
export function daguBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

/** DAGs as rows: suspended, never-run and hidden ones left out. */
export function daguItems(
  base: string,
  dags: DaguDag[],
  hide: string[] = [],
): Item[] {
  const hidden = new Set(hide.map((h) => h.toLowerCase()))
  return dags.flatMap((d): Item[] => {
    const name = d.dag?.name ?? d.fileName ?? ''
    const run = d.latestDAGRun
    if (!name || d.suspended || !run || !run.status) return []
    if (
      hidden.has(name.toLowerCase()) ||
      hidden.has((d.fileName ?? '').toLowerCase())
    )
      return []
    const active = DAGU_ACTIVE.has(run.status)
    return [
      {
        text: name,
        tone: DAGU_TONES[run.status] ?? 'muted',
        at: run.finishedAt || run.startedAt || null,
        url:
          run.dagRunId && run.name
            ? `${base}/dag-runs/${encodeURIComponent(run.name)}/${encodeURIComponent(run.dagRunId)}`
            : `${base}/dags/${encodeURIComponent(d.fileName ?? name)}/`,
        hint: active ? (run.statusLabel ?? 'running') : null,
      },
    ]
  })
}

async function readDagu(service: Service): Promise<Item[]> {
  const base = daguBase(service.settings.DAGU_URL ?? '')
  const { dags } = await getJson<{ dags?: DaguDag[] }>(
    `${base}/api/v1/dags?perPage=1000`,
    { Authorization: `Bearer ${service.settings.DAGU_TOKEN ?? ''}` },
    (status) =>
      new SetupNeeded(
        `Dagu rejected the API key (${status}): paste a new one in Settings`,
        'Dagu → API Keys',
      ),
  )
  return daguItems(base, dags ?? [], parseList(service.settings.DAGU_HIDE))
}

// ---- vercel -------------------------------------------------------------

const VERCEL_API = 'https://api.vercel.com'
// The CLI's store moved: older CLIs used Application Support; 61 writes the
// XDG data dir and leaves the old file to rot (JOURNAL 2026-10-01). Read both
// and trust whichever token expires last.
const VERCEL_CLI_DIRS = [
  join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'),
    'com.vercel.cli',
  ),
  join(homedir(), 'Library/Application Support/com.vercel.cli'),
]
/** Renew this long before the CLI token's expiry, so a tick never races it. */
const RENEW_MARGIN_MS = 60_000
const RENEW_TIMEOUT_MS = 8000

const VERCEL_TONES: Record<string, WidgetTone> = {
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

export type Credentials = {
  token: string | null
  team: string | null
  /** True when the token is the CLI's own, which the CLI can renew. */
  cli: boolean
  /** Epoch seconds the CLI token expires at; null when unknown or pasted. */
  expiresAt: number | null
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Token + team from the service, else the Vercel CLI's own store. */
function vercelCredentials(service: Service): Credentials {
  const stores = VERCEL_CLI_DIRS.map((dir) => ({
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
  const pasted = service.settings.VERCEL_TOKEN || undefined
  const token = pasted ?? (auth.token as string | undefined)
  const team =
    service.settings.VERCEL_TEAM_ID ||
    (cfg.currentTeam as string | undefined) ||
    null
  return {
    token: token ?? null,
    team,
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
async function renewVercelCli(): Promise<void> {
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

/** The CLI login is dead and the CLI couldn't renew it: sign in again. */
function unrenewable(): SetupNeeded {
  return new SetupNeeded(
    'the Vercel CLI login expired and the CLI could not renew it',
    'vercel login',
  )
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

/** Each project's newest production deployment (any, if none is production). */
export function vercelItems(projects: Project[], slug: string | null): Item[] {
  return projects.flatMap((p): Item[] => {
    const deps = p.latestDeployments ?? []
    const prod = deps.filter((d) => d.target === 'production')
    const pool = prod.length ? prod : deps
    if (!pool.length) return []
    const d = pool.reduce((a, b) =>
      (b.createdAt ?? 0) > (a.createdAt ?? 0) ? b : a,
    )
    const state = (d.readyState ?? '').toUpperCase()
    const aliases = d.alias ?? []
    const domain =
      aliases.find((a) => !a.endsWith('.vercel.app')) ?? aliases[0] ?? d.url
    const dpl = (d.id ?? '').replace(/^dpl_/, '')
    return [
      {
        text: domain ? `${p.name} → ${domain}` : p.name,
        tone: VERCEL_TONES[state] ?? 'muted',
        at: d.createdAt ?? null,
        url:
          slug && dpl
            ? `https://vercel.com/${slug}/${p.name}/${dpl}`
            : `https://vercel.com/${slug ?? ''}/${p.name}`,
      },
    ]
  })
}

async function loadVercel({ token, team }: Credentials): Promise<Item[]> {
  if (!token) {
    throw new SetupNeeded(
      'no Vercel credentials: sign in with the Vercel CLI',
      'vercel login',
    )
  }
  const get = <T>(path: string, params: Record<string, string | null> = {}) => {
    const url = new URL(VERCEL_API + path)
    for (const [k, v] of Object.entries(params))
      if (v) url.searchParams.set(k, v)
    return getJson<T>(
      url.toString(),
      { Authorization: `Bearer ${token}` },
      (status) =>
        new SetupNeeded(
          `Vercel rejected the token (${status}): set a new one in Settings`,
          'vercel login',
        ),
    )
  }
  const slug = team
    ? (await get<{ slug?: string }>(`/v2/teams/${team}`)).slug
    : (await get<{ user?: { username?: string } }>('/v2/user')).user?.username
  const { projects } = await get<{ projects: Project[] }>('/v9/projects', {
    teamId: team,
    limit: '100',
  })
  return vercelItems(projects ?? [], slug ?? null)
}

const readVercel = (service: Service): Promise<Item[]> =>
  withRenewal(() => vercelCredentials(service), renewVercelCli, loadVercel)

// ---- the tick -----------------------------------------------------------

const SOURCES: Record<string, (s: Service) => Promise<Item[]>> = {
  github: readGithub,
  dagu: readDagu,
  vercel: readVercel,
}

/** Read every service at once; one failing never blanks the others. */
export async function readAll(
  services: Service[],
  sources = SOURCES,
): Promise<Read[]> {
  return Promise.all(
    services.map(async (service): Promise<Read> => {
      const source = sources[service.type]
      if (!source) {
        return {
          service,
          items: [],
          error: `unknown service type ${service.type}`,
        }
      }
      try {
        return { service, items: await source(service) }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          service,
          items: [],
          error: e instanceof SetupNeeded ? `${msg} (${e.fix})` : msg,
        }
      }
    }),
  )
}

if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === 'manifest') console.log(JSON.stringify(manifest()))
  else if (cmd === 'tick') {
    readAll(parseServices(process.env.SCUTTLER_SERVICES))
      .then((reads) => console.log(JSON.stringify(view(reads))))
      .catch((e) => {
        console.error(e instanceof Error ? e.message : String(e))
        process.exit(1)
      })
  } else {
    console.error('usage: jobs.ts manifest|tick')
    process.exit(1)
  }
}
