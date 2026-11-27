import { describe, expect, it, vi } from 'vitest'

import * as jobs from './jobs'

/**
 * The jobs widget's pure halves (docs/WIDGETS.md). Network and credentials
 * are proven by running `jobs.ts tick` by hand with SCUTTLER_SERVICES set.
 */

const NOW = Date.parse('2026-08-19T12:00:00Z')

const service = (
  type: string,
  label = type,
  settings: Record<string, string> = {},
): jobs.Service => ({ id: type, type, label, settings })

describe('jobs: manifest and services', () => {
  it('declares three service types and no flat settings', () => {
    const m = jobs.manifest()
    expect(m.icon).toBe('activity')
    expect(m.settings).toEqual([])
    expect(m.services.map((s) => s.type)).toEqual(['github', 'dagu', 'vercel'])
    const dagu = m.services[1]!
    expect(
      dagu.settings.map((s) => [s.key, 'required' in s, s.secret ?? false]),
    ).toEqual([
      ['DAGU_URL', true, false],
      ['DAGU_TOKEN', true, true],
      ['DAGU_HIDE', false, false],
    ])
    for (const svc of m.services) {
      const token = svc.settings.find((s) => s.secret)
      expect(token, svc.type).toBeDefined()
    }
  })

  it('parses SCUTTLER_SERVICES defensively', () => {
    expect(jobs.parseServices(undefined)).toEqual([])
    expect(jobs.parseServices('not json')).toEqual([])
    expect(jobs.parseServices('{"id":"x"}')).toEqual([])
    expect(
      jobs.parseServices(
        JSON.stringify([
          {
            id: 'dagu',
            type: 'dagu',
            label: '',
            settings: { DAGU_URL: 'u', N: 3 },
          },
          { type: 'missing-id' },
          null,
        ]),
      ),
    ).toEqual([
      { id: 'dagu', type: 'dagu', label: 'dagu', settings: { DAGU_URL: 'u' } },
    ])
  })

  it('parses lists and repo lists', () => {
    expect(jobs.parseList('a, b\n a ,,')).toEqual(['a', 'b'])
    expect(jobs.parseRepos('a/b, c/d\n a/b, nope')).toEqual(['a/b', 'c/d'])
    expect(jobs.parseRepos(undefined)).toEqual([])
  })

  it('formats ages from ISO strings and epoch ms', () => {
    expect(jobs.age('2026-08-19T11:59:00Z', NOW)).toBe('1m')
    expect(jobs.age(NOW - 2 * 86400_000, NOW)).toBe('2d')
    expect(jobs.age('nope', NOW)).toBeNull()
    expect(jobs.age(null, NOW)).toBeNull()
    expect(jobs.age('', NOW)).toBeNull()
  })
})

describe('jobs: the view', () => {
  const item = (
    text: string,
    tone: jobs.Item['tone'],
    at: string | null,
  ): jobs.Item => ({ text, tone, at, url: `https://x/${text}` })

  it('asks for a service when none is configured', () => {
    const v = jobs.view([], NOW)
    expect(v).toMatchObject({ tone: 'muted', label: null, icon: 'activity' })
    expect(v.card?.subtitle).toBe('no services')
    expect(v.card?.rows?.[0]?.action).toEqual({
      type: 'settings',
      value: 'widgets',
    })
  })

  it('gives each service a section, failing first, and counts across all', () => {
    const v = jobs.view(
      [
        {
          service: service('github', 'GitHub Actions'),
          items: [
            item('new green', 'ok', '2026-08-19T11:50:00Z'),
            item('old red', 'error', '2026-08-10T00:00:00Z'),
            item('running', 'warn', '2026-08-19T11:00:00Z'),
          ],
        },
        {
          service: service('dagu', 'Dagu'),
          items: [item('rss', 'error', '2026-08-19T02:00:00Z')],
        },
      ],
      NOW,
    )
    expect(v).toMatchObject({ tone: 'error', label: '2', icon: 'activity' })
    expect(v.card?.subtitle).toBe('2 failing · 1 running · 1 ok')
    expect(v.card?.sections?.map((s) => s.title)).toEqual([
      'GitHub Actions · 1 failing',
      'Dagu · 1 failing',
    ])
    expect(v.card?.sections?.[0]?.rows.map((r) => r.text)).toEqual([
      'old red',
      'running',
      'new green',
    ])
    expect(v.card?.sections?.[0]?.rows[2]).toMatchObject({
      dot: 'ok',
      hint: '10m',
      action: { type: 'open', value: 'https://x/new green' },
    })
  })

  it('lists every row, none held back', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`w${i}`, 'ok', null))
    const v = jobs.view([{ service: service('github'), items: many }], NOW)
    expect(v.card?.sections?.[0]?.rows).toHaveLength(40)
  })

  it('keeps a failed service as a grey row in its own section', () => {
    const v = jobs.view(
      [
        {
          service: service('dagu', 'Dagu'),
          items: [],
          error: 'Dagu rejected the API key',
        },
        {
          service: service('vercel', 'Vercel'),
          items: [item('site', 'ok', null)],
        },
      ],
      NOW,
    )
    expect(v.tone).toBe('ok')
    expect(v.card?.sections?.[0]?.rows).toEqual([
      { dot: 'muted', text: 'Dagu rejected the API key' },
    ])
    expect(v.card?.sections?.[1]?.rows).toHaveLength(1)
  })

  it('goes amber while something runs and shows a running hint', () => {
    const v = jobs.view(
      [
        {
          service: service('dagu'),
          items: [
            {
              text: 'youtube',
              tone: 'warn',
              at: null,
              url: null,
              hint: 'running',
            },
          ],
        },
      ],
      NOW,
    )
    expect(v).toMatchObject({ tone: 'warn', label: null })
    expect(v.card?.sections?.[0]?.rows[0]).toMatchObject({
      hint: 'running',
      action: null,
    })
  })

  it('reads every service and turns a source failure into its error', async () => {
    const reads = await jobs.readAll(
      [service('github'), service('dagu'), service('nope')],
      {
        github: async () => [item('a', 'ok', null)],
        dagu: async () => {
          throw new jobs.SetupNeeded(
            'Dagu rejected the API key',
            'Dagu → API Keys',
          )
        },
      },
    )
    expect(reads.map((r) => [r.items.length, r.error])).toEqual([
      [1, undefined],
      [0, 'Dagu rejected the API key (Dagu → API Keys)'],
      [0, 'unknown service type nope'],
    ])
  })
})

describe('jobs: github', () => {
  it('keeps the latest run of every workflow, not one per repo', () => {
    const items = jobs.latestPerWorkflow('x/peekay', [
      {
        workflow_id: 1,
        name: 'Deploy',
        status: 'completed',
        conclusion: 'success',
        created_at: 't3',
      },
      {
        workflow_id: 2,
        name: 'RSS',
        status: 'completed',
        conclusion: 'failure',
        created_at: 't2',
      },
      {
        workflow_id: 1,
        name: 'Deploy',
        status: 'completed',
        conclusion: 'failure',
        created_at: 't1',
      },
      { workflow_id: 3, name: 'Sync', status: 'in_progress', conclusion: null },
    ])
    expect(items.map((i) => [i.workflow, i.state])).toEqual([
      ['Deploy', 'success'],
      ['RSS', 'failure'],
      ['Sync', 'in_progress'],
    ])
    expect(items[2]?.url).toBe('https://github.com/x/peekay/actions')
  })

  it('drops runs of workflows that are switched off', () => {
    const active = jobs.activeWorkflows([
      { id: 1, state: 'active' },
      { id: 2, state: 'disabled_manually' },
    ])
    const items = jobs.latestPerWorkflow(
      'x/peekay',
      [
        {
          workflow_id: 2,
          name: 'RSS',
          status: 'completed',
          conclusion: 'failure',
        },
        {
          workflow_id: 1,
          name: 'Deploy',
          status: 'completed',
          conclusion: 'success',
        },
        { name: 'no id', status: 'completed', conclusion: 'failure' },
      ],
      active,
    )
    expect(items.map((i) => i.workflow)).toEqual(['Deploy'])
  })

  it('finds the active workflows a full page of runs left out', () => {
    expect(
      jobs.missingWorkflows(
        [
          { id: 1, state: 'active' },
          { id: 2, state: 'active' },
          { id: 3, state: 'disabled_manually' },
        ],
        [{ workflow_id: 1 }],
      ),
    ).toEqual([2])
  })

  it('names a moved repo as GitHub does now, and shows its runs once', () => {
    const run = {
      workflow_id: 1,
      name: 'CI',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/new/peekay/actions/runs/9',
      repository: { full_name: 'new/peekay' },
    }
    const old = jobs.latestPerWorkflow('old/peekay', [run])
    const now = jobs.latestPerWorkflow('new/peekay', [run])
    expect(old[0]?.repo).toBe('new/peekay')
    expect(jobs.githubItems([...old, ...now])).toEqual([
      {
        text: 'peekay · CI',
        tone: 'error',
        at: null,
        url: 'https://github.com/new/peekay/actions/runs/9',
      },
    ])
  })
})

describe('jobs: dagu', () => {
  const dag = (
    name: string,
    status: number,
    extra: Partial<jobs.DaguDag> = {},
  ): jobs.DaguDag => ({
    fileName: name,
    suspended: false,
    dag: { name },
    latestDAGRun: {
      dagRunId: `run-${name}`,
      name,
      status,
      statusLabel: status === 1 ? 'running' : 'x',
      startedAt: '2026-08-19T11:00:00+10:00',
      finishedAt: status === 1 ? '' : '2026-08-19T11:01:00+10:00',
    },
    ...extra,
  })

  it('trims the base URL', () => {
    expect(jobs.daguBase(' https://nas:8443/ ')).toBe('https://nas:8443')
  })

  it('maps run states and links each run', () => {
    const items = jobs.daguItems('https://nas', [
      dag('putio', 4),
      dag('rss', 2),
      dag('youtube', 1),
      dag('partial', 6),
      dag('queued', 5),
    ])
    expect(items.map((i) => [i.text, i.tone, i.hint ?? null])).toEqual([
      ['putio', 'ok', null],
      ['rss', 'error', null],
      ['youtube', 'warn', 'running'],
      ['partial', 'error', null],
      ['queued', 'warn', 'x'],
    ])
    expect(items[0]).toMatchObject({
      at: '2026-08-19T11:01:00+10:00',
      url: 'https://nas/dag-runs/putio/run-putio',
    })
    expect(items[2]?.at).toBe('2026-08-19T11:00:00+10:00')
  })

  it('leaves out suspended, never-run and hidden DAGs', () => {
    const items = jobs.daguItems(
      'https://nas',
      [
        dag('putio', 4),
        dag('old', 2, { suspended: true }),
        dag('youtube-backfill', 0),
        dag('peekay-sync', 4),
        { fileName: 'bare' },
      ],
      ['Peekay-Sync'],
    )
    expect(items.map((i) => i.text)).toEqual(['putio'])
  })

  it('links the DAG page when the run has no id', () => {
    const [item] = jobs.daguItems('https://nas', [
      { fileName: 'a b', dag: { name: 'a b' }, latestDAGRun: { status: 4 } },
    ])
    expect(item?.url).toBe('https://nas/dags/a%20b/')
  })
})

describe('jobs: vercel', () => {
  it('picks the newest production deployment per project and links its inspector', () => {
    const items = jobs.vercelItems(
      [
        {
          name: 'site',
          latestDeployments: [
            {
              id: 'dpl_old',
              readyState: 'READY',
              target: 'production',
              createdAt: NOW - 7200_000,
              alias: ['site.vercel.app', 'site.com'],
            },
            {
              id: 'dpl_new',
              readyState: 'ERROR',
              target: 'production',
              createdAt: NOW - 60_000,
              alias: ['site.com'],
            },
            {
              id: 'dpl_preview',
              readyState: 'READY',
              target: null,
              createdAt: NOW,
            },
          ],
        },
        {
          name: 'other',
          latestDeployments: [
            {
              id: 'dpl_o',
              readyState: 'BUILDING',
              target: 'production',
              createdAt: NOW,
            },
          ],
        },
        { name: 'empty', latestDeployments: [] },
      ],
      'team',
    )
    expect(items).toEqual([
      {
        text: 'site → site.com',
        tone: 'error',
        at: NOW - 60_000,
        url: 'https://vercel.com/team/site/new',
      },
      {
        text: 'other',
        tone: 'warn',
        at: NOW,
        url: 'https://vercel.com/team/other/o',
      },
    ])
  })

  describe('renewing the CLI login', () => {
    const T = 1_795_000_000_000
    const cli = (token: string, expiresAt: number | null) => ({
      token,
      team: null,
      cli: true,
      expiresAt,
    })
    const rejected = () => new jobs.SetupNeeded('rejected', 'vercel login')

    it('renews an expired CLI token before the first request', async () => {
      let stored = cli('old', T / 1000 - 10)
      const renew = vi.fn(async () => {
        stored = cli('new', T / 1000 + 28800)
      })
      const load = vi.fn(async (c: jobs.Credentials) => c.token)
      await expect(
        jobs.withRenewal(() => stored, renew, load, T),
      ).resolves.toBe('new')
      expect(renew).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('leaves a live token alone', async () => {
      const renew = vi.fn(async () => {})
      await expect(
        jobs.withRenewal(
          () => cli('live', T / 1000 + 3600),
          renew,
          async (c) => c.token,
          T,
        ),
      ).resolves.toBe('live')
      expect(renew).not.toHaveBeenCalled()
    })

    it('renews once and retries when the API rejects a token with no known expiry', async () => {
      let stored = cli('old', null)
      const renew = vi.fn(async () => {
        stored = cli('new', null)
      })
      const load = vi.fn(async (c: jobs.Credentials) => {
        if (c.token === 'old') throw rejected()
        return c.token
      })
      await expect(
        jobs.withRenewal(() => stored, renew, load, T),
      ).resolves.toBe('new')
      expect(renew).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledTimes(2)
    })

    it('asks for a fresh login when the CLI cannot renew, without a doomed request', async () => {
      const load = vi.fn(async () => 'never')
      await expect(
        jobs.withRenewal(
          () => cli('old', T / 1000 - 10),
          async () => {},
          load,
          T,
        ),
      ).rejects.toMatchObject({ fix: 'vercel login' })
      expect(load).not.toHaveBeenCalled()
    })

    it('renews at most once when the renewed token is rejected too', async () => {
      let stored = cli('old', T / 1000 - 10)
      const renew = vi.fn(async () => {
        stored = cli('new', T / 1000 + 28800)
      })
      await expect(
        jobs.withRenewal(
          () => stored,
          renew,
          async () => {
            throw rejected()
          },
          T,
        ),
      ).rejects.toMatchObject({ fix: 'vercel login' })
      expect(renew).toHaveBeenCalledTimes(1)
    })

    it('never runs the CLI for a pasted token', async () => {
      const renew = vi.fn(async () => {})
      await expect(
        jobs.withRenewal(
          () => ({ token: 'pasted', team: null, cli: false, expiresAt: null }),
          renew,
          async () => {
            throw rejected()
          },
          T,
        ),
      ).rejects.toMatchObject({ message: 'rejected' })
      expect(renew).not.toHaveBeenCalled()
    })
  })
})
