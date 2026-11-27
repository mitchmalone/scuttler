import { describe, expect, it, vi } from 'vitest'

import * as actions from './github-actions'
import * as trmnl from './trmnl'
import * as uptime from './uptime'
import * as vercel from './vercel'

/**
 * The reference widgets' pure halves (docs/WIDGETS.md). Each `view` turns a
 * payload into a WidgetView; the network/credential halves stay untested here
 * and are proven by running `<widget> tick` by hand.
 */

const NOW = Date.parse('2026-08-19T12:00:00Z')

describe('uptime', () => {
  const PAGE = 'https://kuma.example/status/home'
  const page = {
    publicGroupList: [
      {
        name: 'Sites',
        monitorList: [
          { id: 1, name: 'a', url: 'https://a' },
          { id: 2, name: 'b' },
        ],
      },
    ],
  }

  it('reads the origin and slug from the status page address', () => {
    expect(uptime.parsePage('https://k.example:8444/status/status')).toEqual({
      origin: 'https://k.example:8444',
      slug: 'status',
      page: 'https://k.example:8444/status/status',
    })
    expect(uptime.parsePage('https://k.example/')?.slug).toBe('default')
    expect(uptime.parsePage('k.example')).toBeNull()
    expect(uptime.parsePage(undefined)).toBeNull()
    expect(uptime.manifest().settings[0]).toMatchObject({ required: true })
  })

  it('is quiet with no label while everything is up', () => {
    const v = uptime.view(
      page,
      {
        heartbeatList: {
          '1': [
            { status: 0, ping: null },
            { status: 1, ping: 200.4 },
          ],
          '2': [{ status: 1, ping: 300 }],
        },
        uptimeList: { '1_24': 0.9991, '2_24': 1 },
      },
      PAGE,
    )
    expect(v).toMatchObject({ tone: 'ok', icon: 'arrow-big-up', label: null })
    expect(v.click).toEqual({ type: 'open', value: PAGE })
    expect(v.card?.subtitle).toBe('all 2 up')
    // The latest beat is the last one; a shared URL opens the site.
    expect(v.card?.rows?.[0]).toMatchObject({
      dot: 'ok',
      text: 'a',
      hint: '99.91% · 200 ms',
      action: { type: 'open', value: 'https://a' },
    })
    // No shared URL: the row opens the status page.
    expect(v.card?.rows?.[1]).toMatchObject({
      hint: '100% · 300 ms',
      action: { type: 'open', value: PAGE },
    })
  })

  it('counts the down monitors on the cell and marks their rows', () => {
    const v = uptime.view(
      page,
      {
        heartbeatList: { '1': [{ status: 1, ping: 1 }], '2': [{ status: 0 }] },
        uptimeList: { '2_24': 0.5 },
      },
      PAGE,
    )
    expect(v).toMatchObject({
      tone: 'error',
      icon: 'arrow-big-down',
      label: '1',
    })
    expect(v.card?.subtitle).toBe('1 of 2 down')
    expect(v.card?.rows?.[1]).toMatchObject({
      dot: 'error',
      hint: 'down · 50.0%',
    })
  })

  it('tells pending, maintenance and no data apart from down', () => {
    const v = uptime.view(
      {
        publicGroupList: [
          {
            name: 'g',
            monitorList: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        ],
      },
      { heartbeatList: { '1': [{ status: 2 }], '2': [{ status: 3 }] } },
      PAGE,
    )
    expect(v.tone).toBe('ok')
    expect(v.card?.rows?.map((r) => [r.dot, r.hint])).toEqual([
      ['warn', 'pending'],
      ['muted', 'maintenance'],
      ['muted', 'no data'],
    ])
  })

  it('keeps group names when the page has several', () => {
    const v = uptime.view(
      {
        publicGroupList: [
          { name: 'Sites', monitorList: [{ id: 1, name: 'a' }] },
          { name: 'Empty', monitorList: [] },
          { name: 'Home', monitorList: [{ id: 2, name: 'nas' }] },
        ],
      },
      {},
      PAGE,
    )
    expect(v.card?.rows).toBeUndefined()
    expect(v.card?.sections?.map((s) => s.title)).toEqual(['Sites', 'Home'])
    expect(uptime.view({}, {}, PAGE).card?.subtitle).toBe(
      'no monitors on the page',
    )
  })

  it('never rounds a miss up to 100%', () => {
    expect(uptime.uptimePct(1)).toBe('100%')
    expect(uptime.uptimePct(0.99999)).toBe('99.99%')
    expect(uptime.uptimePct(0.9825)).toBe('98.3%')
    expect(uptime.uptimePct(0.9996)).toBe('99.96%')
    expect(uptime.uptimePct(undefined)).toBeNull()
  })
})

describe('github-actions', () => {
  const items = [
    {
      repo: 'x/a',
      workflow: 'CI',
      state: 'success',
      url: 'https://gh/a',
      createdAt: '2026-08-19T11:00:00Z',
    },
    {
      repo: 'x/b',
      workflow: 'Deploy',
      state: 'failure',
      url: 'https://gh/b',
      createdAt: '2026-08-19T11:30:00Z',
    },
  ]

  it('declares the optional token override and the gh prerequisite', () => {
    const m = actions.manifest()
    // Sign-in is offered only with a client id baked in (none in test env).
    expect(m.auth).toBeUndefined()
    expect(m.settings.map((s) => s.key)).toEqual([
      'GITHUB_TOKEN',
      'GITHUB_REPOS',
    ])
    expect(m.settings[0]).toMatchObject({ secret: true })
    expect('required' in m.settings[0]!).toBe(false)
    expect(m.requires[0]).toMatchObject({
      fix: 'brew install gh && gh auth login',
    })
  })

  it('tones by state and counts failures', () => {
    const v = actions.view(items, 'https://gh', NOW)
    expect(v).toMatchObject({ tone: 'error', icon: 'monitor-x', label: '1' })
    expect(v.click).toEqual({ type: 'open', value: 'https://gh' })
    expect(v.card?.subtitle).toBe('1 failing · 1 healthy')
    expect(v.card?.rows?.map((r) => r.text)).toEqual(['b · Deploy', 'a · CI'])
    expect(v.card?.rows?.[0]).toMatchObject({ dot: 'error', hint: '30m' })
    expect(v.card?.rows?.[1]).toMatchObject({ dot: 'ok', hint: '1h' })
  })

  it('goes amber while something runs, quiet with no runs', () => {
    const v = actions.view(
      [
        {
          repo: 'r',
          workflow: 'w',
          state: 'in_progress',
          url: '',
          createdAt: '',
        },
      ],
      'https://gh',
      NOW,
    )
    expect(v).toMatchObject({
      tone: 'warn',
      label: null,
      icon: 'monitor-check',
    })
    expect(actions.view([], 'https://gh', NOW).card?.subtitle).toBe('no runs')
  })

  it('puts failing first, then running, then newest', () => {
    const run = (workflow: string, state: string, createdAt: string) => ({
      repo: 'x/r',
      workflow,
      state,
      url: '',
      createdAt,
    })
    const v = actions.view(
      [
        run('new green', 'success', '2026-08-19T11:50:00Z'),
        run('old red', 'failure', '2026-08-10T00:00:00Z'),
        run('running', 'in_progress', '2026-08-19T11:00:00Z'),
        run('old green', 'success', '2026-08-01T00:00:00Z'),
      ],
      'https://gh',
      NOW,
    )
    expect(v.card?.rows?.map((r) => r.text)).toEqual([
      'r · old red',
      'r · running',
      'r · new green',
      'r · old green',
    ])
    expect(v.card?.subtitle).toBe('1 failing · 1 running · 2 healthy')
  })

  it('lists every run, none held back', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      repo: 'x/r',
      workflow: `w${i}`,
      state: 'success',
      url: '',
      createdAt: '',
    }))
    const card = actions.view(many, 'https://gh', NOW).card
    expect(card?.rows).toHaveLength(40)
    expect(card?.hint).toBe('click a run to open it')
  })

  it('drops runs of workflows that are switched off', () => {
    const active = actions.activeWorkflows([
      { id: 1, state: 'active' },
      { id: 2, state: 'disabled_manually' },
    ])
    const items = actions.latestPerWorkflow(
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

  it('names a moved repo as GitHub does now, and shows its runs once', () => {
    const run = {
      workflow_id: 1,
      name: 'CI',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/new/peekay/actions/runs/9',
      repository: { full_name: 'new/peekay' },
    }
    const old = actions.latestPerWorkflow('old/peekay', [run])
    const now = actions.latestPerWorkflow('new/peekay', [run])
    expect(old[0]?.repo).toBe('new/peekay')
    expect(actions.dedupeRuns([...old, ...now])).toHaveLength(1)
  })

  it('keeps the latest run of every workflow, not one per repo', () => {
    const items = actions.latestPerWorkflow('x/peekay', [
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

  it('finds the active workflows a full page of runs left out', () => {
    expect(
      actions.missingWorkflows(
        [
          { id: 1, state: 'active' },
          { id: 2, state: 'active' },
          { id: 3, state: 'disabled_manually' },
        ],
        [{ workflow_id: 1 }],
      ),
    ).toEqual([2])
  })

  it('parses the repo list setting', () => {
    expect(actions.parseRepos('a/b, c/d\n a/b')).toEqual(['a/b', 'c/d'])
    expect(actions.parseRepos('not a repo')).toEqual([])
    expect(actions.parseRepos(undefined)).toEqual([])
  })

  it('formats ages', () => {
    expect(actions.age('2026-08-19T11:59:00Z', NOW)).toBe('1m')
    expect(actions.age('2026-08-17T12:00:00Z', NOW)).toBe('2d')
    expect(actions.age('nope', NOW)).toBeNull()
    expect(actions.age(undefined, NOW)).toBeNull()
  })
})

describe('vercel', () => {
  it('declares one optional secret token and the CLI prerequisite', () => {
    const m = vercel.manifest()
    expect(m.settings.map((s) => s.key)).toEqual(['VERCEL_TOKEN'])
    expect(m.settings[0]).toMatchObject({ secret: true })
    expect('required' in m.settings[0]!).toBe(false)
    expect(m.requires[0]).toMatchObject({ fix: 'vercel login' })
  })

  describe('renewing the CLI login', () => {
    const T = 1_795_000_000_000
    const cli = (token: string, expiresAt: number | null) => ({
      token,
      team: null,
      cli: true,
      expiresAt,
    })
    const rejected = () => new vercel.SetupNeeded('rejected', 'vercel login')

    it('renews an expired CLI token before the first request', async () => {
      let stored = cli('old', T / 1000 - 10)
      const renew = vi.fn(async () => {
        stored = cli('new', T / 1000 + 28800)
      })
      const load = vi.fn(async (c: vercel.Credentials) => c.token)
      await expect(
        vercel.withRenewal(() => stored, renew, load, T),
      ).resolves.toBe('new')
      expect(renew).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('leaves a live token alone', async () => {
      const renew = vi.fn(async () => {})
      await expect(
        vercel.withRenewal(
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
      const load = vi.fn(async (c: vercel.Credentials) => {
        if (c.token === 'old') throw rejected()
        return c.token
      })
      await expect(
        vercel.withRenewal(() => stored, renew, load, T),
      ).resolves.toBe('new')
      expect(renew).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledTimes(2)
    })

    it('asks for a fresh login when the CLI cannot renew, without a doomed request', async () => {
      const load = vi.fn(async () => 'never')
      await expect(
        vercel.withRenewal(
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
        vercel.withRenewal(
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
        vercel.withRenewal(
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

  it('picks the newest production deployment per project and links its inspector', () => {
    const v = vercel.view(
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
      NOW,
    )
    expect(v).toMatchObject({
      tone: 'error',
      icon: 'triangle-dashed',
      label: '1',
    })
    expect(v.card?.subtitle).toBe('1 failed')
    expect(v.card?.rows?.map((r) => r.text)).toEqual([
      'other',
      'site → site.com',
    ])
    expect(v.card?.rows?.[1]).toMatchObject({
      dot: 'error',
      hint: '1m',
      action: { type: 'open', value: 'https://vercel.com/team/site/new' },
    })
    expect(v.click).toEqual({ type: 'open', value: 'https://vercel.com/team' })
  })

  it('is amber while deploying and blue when all ready', () => {
    const building = vercel.view(
      [
        {
          name: 'a',
          latestDeployments: [{ readyState: 'QUEUED', target: 'production' }],
        },
      ],
      null,
      NOW,
    )
    expect(building.tone).toBe('warn')
    expect(building.card?.subtitle).toBe('deploying…')
    const ready = vercel.view(
      [
        {
          name: 'a',
          latestDeployments: [{ readyState: 'READY', target: 'production' }],
        },
      ],
      null,
      NOW,
    )
    expect(ready).toMatchObject({ tone: 'ok', icon: 'triangle' })
    expect(ready.card?.subtitle).toBe('1 projects ready')
  })
})

describe('trmnl', () => {
  it('tones by the lowest device and prints the number only in the red tier', () => {
    const v = trmnl.view(
      [
        { name: 'Desk', percent_charged: 87.4, battery_voltage: 4.1 },
        {
          name: 'Kitchen',
          percent_charged: 12,
          hardware_last_ping_at: '2026-08-19T11:50:00Z',
        },
      ],
      NOW,
    )
    expect(v).toMatchObject({ tone: 'error', label: '12%', icon: 'tablet' })
    expect(v.card?.subtitle).toBe('2 devices')
    expect(v.card?.rows?.[0]).toMatchObject({
      dot: 'ok',
      text: 'Desk · 87%',
      hint: '4.1V',
    })
    expect(v.card?.rows?.[1]).toMatchObject({
      dot: 'error',
      text: 'Kitchen · 12%',
      hint: '10m ago',
    })
  })

  it('is amber at 40 % and muted with no readings', () => {
    expect(trmnl.tone(40)).toBe('warn')
    expect(trmnl.tone(41)).toBe('ok')
    const v = trmnl.view([{ name: 'x' }], NOW)
    expect(v.tone).toBe('muted')
    expect(v.label).toBeNull()
    expect(v.card?.rows?.[0]?.text).toBe('x')
  })
})
