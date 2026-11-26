// scuttler widget: latest GitHub Actions run per workflow (docs/WIDGETS.md).
//
// Credentials piggyback on the GitHub CLI (`gh auth token` — gh keeps its own
// token fresh), or a pasted GITHUB_TOKEN setting overrides it. No CLI and no
// token → the cell goes dim with the fix (`gh auth login`) in the card and in
// Settings — alerted, never silently blank (Mitch, 2026-08-20). The `auth`
// device flow is still here but dormant: it lights up only when a CLIENT_ID
// for a scuttler OAuth App is baked in below.
//
// Each tick: the repos pinned in the GITHUB_REPOS setting plus the ten you
// pushed to most recently, and the latest run of every workflow in each (one
// run per repo hid a failing scheduled workflow behind a newer green one).
// The cell is a monitor, red with the failing count while anything is
// failing, amber while something runs; the card lists failing first, then
// running, then newest.
//
// Install: copy into ~/.config/scuttler/widgets/. Runs under Bun.
import type { WidgetTone, WidgetView } from '@scuttler/tui/bar/types'

/** Thrown when the fix is the user's, not the widget's — becomes `setup`. */
class SetupNeeded extends Error {
  fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

const API = 'https://api.github.com'
const MAX_ROWS = 12
const DEFAULT_REPOS = 10
/** Runs read per repo in one page; workflows not in it are asked for one by one. */
const RUNS_PER_REPO = 100
/**
 * scuttler's GitHub OAuth App (device flow enabled). A client id is public —
 * it names the app the user is approving, nothing more. Fill in once the app
 * is registered; until then sign-in explains itself. Override for a fork with
 * GITHUB_CLIENT_ID in the environment.
 */
const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? ''

const TONES: Record<string, WidgetTone> = {
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

/** One workflow's latest run, as `view` wants it. */
export type RunItem = {
  repo: string
  workflow: string
  /** `conclusion` once completed, else `status` (queued, in_progress, …). */
  state: string
  url: string
  createdAt: string
}

export function manifest() {
  return {
    id: 'github-actions',
    name: 'GitHub Actions',
    interval: 120,
    zone: 'right',
    icon: 'monitor-check',
    timeout: 20,
    settings: [
      {
        key: 'GITHUB_TOKEN',
        label: 'GitHub',
        hint: 'optional — a token to use instead of the GitHub CLI',
        secret: true,
      },
      {
        key: 'GITHUB_REPOS',
        label: 'Pinned repos',
        hint: 'owner/repo, comma separated: always watched, on top of your ten most recently pushed',
      },
    ],
    requires: [
      {
        label: 'GitHub CLI, signed in (or a pasted token)',
        fix: 'brew install gh && gh auth login',
      },
    ],
    // No client id baked in (a fork, a dev build) → no sign-in button at all;
    // the token row alone is the honest UI.
    ...(CLIENT_ID ? { auth: { label: 'Sign in with GitHub' } } : {}),
  }
}

/** '3m' / '2h' / '4d' since an ISO-8601 timestamp, or null. */
export function age(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** Failing first, then running, then the rest; newest first within each. */
const RANK: Record<string, number> = { error: 0, warn: 1 }
const rank = (r: RunItem) => RANK[TONES[r.state] ?? ''] ?? 2

/** The view for a set of latest runs — pure, so it's testable. */
export function view(
  items: RunItem[],
  home = 'https://github.com',
  now = Date.now(),
): WidgetView {
  const runs = [...items].sort(
    (a, b) => rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1),
  )
  const failing = runs.filter((r) => TONES[r.state] === 'error').length
  const running = runs.filter((r) => TONES[r.state] === 'warn').length
  const healthy = runs.filter((r) => TONES[r.state] === 'ok').length
  const counts = [
    failing ? `${failing} failing` : null,
    running ? `${running} running` : null,
    healthy ? `${healthy} healthy` : null,
  ].filter(Boolean)
  const hidden = runs.length - MAX_ROWS
  return {
    icon: failing ? 'monitor-x' : 'monitor-check',
    label: failing ? String(failing) : null,
    tone: failing ? 'error' : running ? 'warn' : 'ok',
    click: { type: 'open', value: home },
    card: {
      title: 'GitHub Actions',
      subtitle: counts.length ? counts.join(' · ') : 'no runs',
      rows: runs.slice(0, MAX_ROWS).map((r) => ({
        dot: TONES[r.state] ?? 'muted',
        // The owner is dropped: the workflow name is what gets truncated.
        text: `${r.repo.split('/').pop()} · ${r.workflow}`,
        hint: age(r.createdAt, now),
        action: { type: 'open' as const, value: r.url },
      })),
      hint:
        hidden > 0
          ? `${hidden} more not shown · click a run to open it`
          : 'click a run to open it',
    },
  }
}

/**
 * The latest run of each workflow in one repo. `runs` is GitHub's list,
 * newest first, so the first run seen per workflow is its latest.
 */
export function latestPerWorkflow(
  repo: string,
  runs: WorkflowRun[],
): RunItem[] {
  const seen = new Set<string>()
  const out: RunItem[] = []
  for (const run of runs) {
    const key = String(run.workflow_id ?? run.name ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      repo,
      workflow: run.name ?? 'workflow',
      state:
        run.status === 'completed'
          ? (run.conclusion ?? 'unknown')
          : (run.status ?? 'unknown'),
      url: run.html_url ?? `https://github.com/${repo}/actions`,
      createdAt: run.created_at ?? '',
    })
  }
  return out
}

export type Workflow = { id?: number; state?: string }

/** Ids of the active workflows that have no run in `runs`. */
export function missingWorkflows(
  workflows: Workflow[],
  runs: WorkflowRun[],
): number[] {
  const seen = new Set(runs.map((r) => r.workflow_id))
  return workflows
    .filter((w) => w.state === 'active' && w.id != null && !seen.has(w.id))
    .map((w) => w.id as number)
}

/** `owner/repo,owner/repo` → trimmed, deduped, empties dropped. */
export function parseRepos(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s)),
    ),
  ]
}

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'scuttler-widget',
    },
    signal: AbortSignal.timeout(12000),
  })
  if (res.status === 401) {
    throw new SetupNeeded(
      'GitHub rejected the credentials — sign in again',
      'gh auth login',
    )
  }
  if (!res.ok) throw new Error(`github api ${res.status} on ${path}`)
  return (await res.json()) as T
}

type Repo = { full_name: string; html_url?: string }
export type WorkflowRun = {
  workflow_id?: number
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  created_at?: string
}

/**
 * The GitHub CLI's token — gh refreshes its own credential store. Launched
 * from Finder, scuttler's PATH is bare, so the usual homes are probed too.
 */
async function ghCliToken(): Promise<string | null> {
  const candidates = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']
  for (const gh of candidates) {
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

async function tick(): Promise<WidgetView> {
  const token = process.env.GITHUB_TOKEN ?? (await ghCliToken())
  if (!token) {
    return {
      setup: {
        message: 'no GitHub credentials — sign in with the GitHub CLI',
        fix: 'gh auth login',
      },
    }
  }
  const mine = await gh<Repo[]>(
    `/user/repos?sort=pushed&per_page=${DEFAULT_REPOS}&affiliation=owner,collaborator,organization_member`,
    token,
  )
  const repos = [
    ...new Set([
      ...parseRepos(process.env.GITHUB_REPOS),
      ...mine.map((r) => r.full_name),
    ]),
  ]
  const items = (
    await Promise.all(
      repos.map(async (repo): Promise<RunItem[]> => {
        try {
          const { workflow_runs } = await gh<{ workflow_runs: WorkflowRun[] }>(
            `/repos/${repo}/actions/runs?per_page=${RUNS_PER_REPO}`,
            token,
          )
          const runs = workflow_runs ?? []
          // A full page can leave out a workflow that last ran long ago
          // behind busier ones; ask for those directly.
          if (runs.length === RUNS_PER_REPO) {
            const { workflows } = await gh<{ workflows: Workflow[] }>(
              `/repos/${repo}/actions/workflows?per_page=100`,
              token,
            )
            const rest = await Promise.all(
              missingWorkflows(workflows ?? [], runs).map((id) =>
                gh<{ workflow_runs: WorkflowRun[] }>(
                  `/repos/${repo}/actions/workflows/${id}/runs?per_page=1`,
                  token,
                ).then((r) => r.workflow_runs?.[0]),
              ),
            )
            runs.push(...rest.filter((r): r is WorkflowRun => r != null))
          }
          return latestPerWorkflow(repo, runs)
        } catch (e) {
          if (e instanceof SetupNeeded) throw e
          // One unreachable repo (renamed, no access) is a grey row, not a
          // dead widget.
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
  const me = await gh<{ login?: string }>('/user', token)
  const home = me.login
    ? `https://github.com/${me.login}?tab=repositories`
    : 'https://github.com'
  return view(items, home)
}

/** A line of the auth protocol (widgets.rs): printed as one JSON object. */
function say(obj: Record<string, unknown>) {
  console.log(JSON.stringify(obj))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GitHub's OAuth device flow (docs.github.com → "Authorizing OAuth apps" →
 * device flow): ask for a code, show it, poll until the user approves, hand
 * the token back to scuttler as a secret setting.
 */
async function auth(): Promise<void> {
  const clientId = CLIENT_ID
  if (!clientId) {
    throw new Error(
      'this build has no GitHub OAuth client id yet — paste a token instead',
    )
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'scuttler-widget',
  }
  const start = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers,
    body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
    signal: AbortSignal.timeout(12000),
  })
  if (!start.ok) throw new Error(`device code request failed (${start.status})`)
  const dev = (await start.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!dev.device_code || !dev.user_code) {
    throw new Error(dev.error_description ?? dev.error ?? 'no device code')
  }
  say({
    url: dev.verification_uri ?? 'https://github.com/login/device',
    code: dev.user_code,
  })
  let interval = (dev.interval ?? 5) * 1000
  const deadline = Date.now() + (dev.expires_in ?? 900) * 1000
  while (Date.now() < deadline) {
    await sleep(interval)
    const poll = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_id: clientId,
        device_code: dev.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal: AbortSignal.timeout(12000),
    })
    const body = (await poll.json()) as {
      access_token?: string
      error?: string
      error_description?: string
    }
    if (body.access_token) {
      say({ settings: { GITHUB_TOKEN: body.access_token } })
      return
    }
    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        interval += 5000
        continue
      case 'expired_token':
        throw new Error('the code expired — sign in again')
      case 'access_denied':
        throw new Error('sign-in was cancelled on GitHub')
      default:
        throw new Error(
          body.error_description ?? body.error ?? 'sign-in failed',
        )
    }
  }
  throw new Error('the code expired — sign in again')
}

if (import.meta.main) {
  const cmd = process.argv[2]
  const fail = (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
  if (cmd === 'manifest') console.log(JSON.stringify(manifest()))
  else if (cmd === 'tick') {
    tick()
      .then((v) => console.log(JSON.stringify(v)))
      .catch((e) => {
        if (e instanceof SetupNeeded) {
          console.log(
            JSON.stringify({ setup: { message: e.message, fix: e.fix } }),
          )
        } else fail(e)
      })
  } else if (cmd === 'auth') {
    auth().catch(fail)
  } else {
    console.error('usage: github-actions.ts manifest|tick|auth')
    process.exit(1)
  }
}
