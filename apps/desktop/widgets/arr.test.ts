import { describe, expect, it } from 'vitest'

import {
  type AppSnapshot,
  type Download,
  type Issue,
  diskIssues,
  eta,
  healthIssues,
  indexerIssues,
  manifest,
  middle,
  normalizeUrl,
  pipelineSnapshot,
  queueDownloads,
  toView,
} from './arr'

/**
 * The `arr` widget's pure half (docs/WIDGETS.md): classification of each API
 * payload and `toView`. The fetch shell is proven by running `arr.ts tick`.
 */

const NOW = Date.parse('2026-11-23T05:00:00Z')
const MIN = 60_000
const GB = 1024 ** 3
const RADARR = 'http://beebee:7878'
const SONARR = 'http://beebee:8989'

const up = (
  app: AppSnapshot['app'],
  url: string,
  extra: Partial<Extract<AppSnapshot, { state: 'up' }>> = {},
): AppSnapshot => ({
  app,
  state: 'up',
  url,
  version: '1.2.3',
  issues: [],
  downloads: [],
  ...extra,
})
const dl = (title: string, extra: Partial<Download> = {}): Download => ({
  app: 'radarr',
  title,
  progress: 42,
  eta: '12m',
  level: 'ok',
  ...extra,
})
const rows = (snaps: AppSnapshot[]) => toView(snaps, NOW).card?.rows ?? []

describe('arr manifest', () => {
  it('declares a URL and a secret key per app, none required', () => {
    const m = manifest()
    expect(m.id).toBe('arr')
    expect(m.settings.map((s) => s.key)).toEqual([
      'RADARR_URL',
      'RADARR_API_KEY',
      'SONARR_URL',
      'SONARR_API_KEY',
      'PROWLARR_URL',
      'PROWLARR_API_KEY',
      'BAZARR_URL',
      'BAZARR_API_KEY',
      'PIPELINE_STATUS_URL',
    ])
    for (const s of m.settings) {
      expect('secret' in s && s.secret === true).toBe(s.key.endsWith('_KEY'))
      expect(s).not.toHaveProperty('required')
    }
  })
})

describe('arr helpers', () => {
  it('normalizes what the user typed', () => {
    expect(normalizeUrl(' beebee:7878/ ')).toBe('http://beebee:7878')
    expect(normalizeUrl('https://media.example/radarr/')).toBe(
      'https://media.example/radarr',
    )
    expect(normalizeUrl('http://user:pw@beebee:7878/?apikey=x#y')).toBe(
      'http://beebee:7878',
    )
    expect(normalizeUrl('ftp://beebee')).toBeNull()
    expect(normalizeUrl('  ')).toBeNull()
    expect(normalizeUrl(undefined)).toBeNull()
  })

  it('shortens long titles in the middle', () => {
    const long =
      'The.Lord.of.the.Rings.The.Return.of.the.King.2003.EXTENDED.2160p'
    expect(middle('short')).toBe('short')
    expect(middle(long)).toHaveLength(48)
    expect(middle(long)).toMatch(/^The\.Lord.*….*2160p$/)
  })

  it('reads an *arr timeleft', () => {
    expect(eta('00:12:34')).toBe('12m')
    expect(eta('02:05:00')).toBe('2h 5m')
    expect(eta('1.02:03:04')).toBe('1d')
    expect(eta('00:00:20')).toBe('<1m')
    expect(eta(undefined)).toBeUndefined()
  })
})

describe('arr classification', () => {
  it('keeps health errors and warnings, drops notices', () => {
    expect(
      healthIssues('radarr', [
        {
          type: 'error',
          message: 'All indexers are unavailable',
          wikiUrl: 'https://wiki.servarr.com/x',
        },
        {
          type: 'warning',
          message: 'Update available',
          wikiUrl: 'javascript:alert(1)',
        },
        { type: 'notice', message: 'fyi' },
        { type: 'ok', message: 'fine' },
      ]),
    ).toEqual([
      {
        app: 'radarr',
        level: 'error',
        text: 'All indexers are unavailable',
        link: 'https://wiki.servarr.com/x',
      },
      {
        app: 'radarr',
        level: 'warn',
        text: 'Update available',
        link: undefined,
      },
    ])
  })

  it("reads Bazarr's health shape as warnings", () => {
    expect(
      healthIssues('bazarr', {
        data: [{ object: 'Sonarr', issue: 'unreachable' }],
      }),
    ).toEqual([{ app: 'bazarr', level: 'warn', text: 'Sonarr: unreachable' }])
    expect(healthIssues('bazarr', { data: [] })).toEqual([])
  })

  it('grades queue records', () => {
    const [ok, blocked, stalled, failed] = queueDownloads(
      'radarr',
      {
        records: [
          {
            id: 1,
            title: 'Dune.Part.Two.2024.2160p',
            movie: { title: 'Dune: Part Two', year: 2024 },
            status: 'downloading',
            trackedDownloadStatus: 'ok',
            trackedDownloadState: 'downloading',
            size: 1000,
            sizeleft: 580,
            timeleft: '00:12:00',
          },
          {
            id: 2,
            title: 'Blocked.Release',
            status: 'completed',
            trackedDownloadStatus: 'warning',
            trackedDownloadState: 'importBlocked',
            statusMessages: [
              {
                title: 'x',
                messages: ['No files found are eligible for import'],
              },
            ],
            size: 10,
            sizeleft: 0,
          },
          {
            id: 3,
            title: 'Stalled.Release',
            status: 'warning',
            trackedDownloadStatus: 'warning',
            trackedDownloadState: 'downloading',
            errorMessage: 'The download is stalled with no connections',
          },
          {
            id: 4,
            title: 'Failed.Release',
            trackedDownloadState: 'failedPending',
          },
        ],
      },
      NOW,
    )
    expect(ok).toEqual({
      app: 'radarr',
      title: 'Dune: Part Two (2024)',
      progress: 42,
      eta: '12m',
      level: 'ok',
      note: undefined,
    })
    expect(blocked).toMatchObject({
      title: 'Blocked.Release',
      level: 'error',
      progress: 100,
      note: 'No files found are eligible for import',
    })
    expect(stalled).toMatchObject({
      level: 'warn',
      progress: undefined,
      note: 'The download is stalled with no connections',
    })
    expect(failed).toMatchObject({ level: 'error', note: 'failedpending' })
  })

  it('names an episode and warns once an import has waited 30 minutes', () => {
    const record = {
      id: 9,
      title: 'Severance.S02E04.1080p',
      series: { title: 'Severance' },
      episode: { seasonNumber: 2, episodeNumber: 4 },
      trackedDownloadStatus: 'ok',
      trackedDownloadState: 'importPending',
    }
    const at = (since: number) =>
      queueDownloads('sonarr', { records: [record] }, NOW, {
        'sonarr:9': since,
      })[0]
    expect(at(NOW - 10 * MIN)).toMatchObject({
      title: 'Severance S02E04',
      level: 'ok',
    })
    expect(at(NOW - 45 * MIN)).toMatchObject({
      level: 'warn',
      note: 'waiting to import for 45m',
    })
    // Never seen before: the clock starts now.
    expect(queueDownloads('sonarr', { records: [record] }, NOW)[0]?.level).toBe(
      'ok',
    )
  })

  it('judges free space per root folder, once per mount', () => {
    const disks = [
      { path: '/', freeSpace: 1 * GB, totalSpace: 20 * GB },
      { path: '/data', freeSpace: 38 * GB, totalSpace: 2000 * GB },
      { path: '/tiny', freeSpace: 60 * GB, totalSpace: 80 * GB },
    ]
    expect(
      diskIssues(
        'radarr',
        [
          { path: '/data/movies', freeSpace: 38 * GB },
          { path: '/data/movies-4k', freeSpace: 38 * GB },
        ],
        disks,
      ),
    ).toEqual([
      { app: 'radarr', level: 'warn', text: '38 GB free on /data/movies' },
    ])
    expect(
      diskIssues(
        'radarr',
        [{ path: '/data/movies', freeSpace: 8 * GB }],
        disks,
      ),
    ).toMatchObject([{ level: 'error' }])
    // Plenty free and over 5 %: quiet. The small system mount is never judged.
    expect(
      diskIssues('radarr', [{ path: '/tiny/tv', freeSpace: 60 * GB }], disks),
    ).toEqual([])
    // Lots of bytes but under 5 % of a huge array.
    expect(
      diskIssues('sonarr', [{ path: '/data/tv', freeSpace: 90 * GB }], disks),
    ).toMatchObject([{ level: 'warn' }])
    expect(diskIssues('radarr', undefined, undefined)).toEqual([])
  })

  it('reports indexers still disabled, by name', () => {
    const issues = indexerIssues(
      [
        { indexerId: 3, disabledTill: new Date(NOW + 40 * MIN).toISOString() },
        { indexerId: 4, disabledTill: new Date(NOW - 40 * MIN).toISOString() },
        { indexerId: 5 },
      ],
      [{ id: 3, name: 'NZBgeek' }],
      NOW,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ app: 'prowlarr', level: 'warn' })
    expect(issues[0]?.text).toMatch(
      /^Indexer NZBgeek disabled until \d\d:\d\d$/,
    )
  })
})

describe('arr pipeline status', () => {
  const body = {
    version: 2,
    somethingNew: true,
    queue: {
      pending: 1,
      running: { path: '/media/in/Movie (2021).mkv', startedAt: 'x' },
    },
    failures: [
      {
        path: '/m/Bad (2020).mkv',
        reason: 'verify failed: audio stream count',
        time: new Date(NOW - 2 * 86_400_000).toISOString(),
      },
      {
        path: '/m/Old (2019).mkv',
        reason: 'old',
        time: new Date(NOW - 8 * 86_400_000).toISOString(),
      },
    ],
    warnings: [
      {
        path: '/m/Subs (2022).mkv',
        reason: 'no-forced-main-language',
        time: new Date(NOW - 3_600_000).toISOString(),
      },
      {
        path: '/m/Ancient.mkv',
        reason: 'x',
        time: new Date(NOW - 30 * 86_400_000).toISOString(),
      },
    ],
  }

  it('maps failures, warnings and the running job, last 7 days only', () => {
    expect(
      pipelineSnapshot(body, 'http://beebee:9099/status.json', NOW),
    ).toEqual({
      app: 'pipeline',
      state: 'up',
      url: 'http://beebee:9099/status.json',
      issues: [
        {
          app: 'pipeline',
          level: 'error',
          text: 'Bad (2020).mkv',
          hint: 'verify failed: audio stream count',
        },
        {
          app: 'pipeline',
          level: 'warn',
          text: 'Subs (2022).mkv',
          hint: 'no forced English subtitles',
        },
      ],
      downloads: [
        { app: 'pipeline', title: 'Converting Movie (2021).mkv', level: 'ok' },
      ],
      pending: 1,
    })
  })

  it('is down on a body it cannot read, idle on an empty one', () => {
    expect(pipelineSnapshot('<html>', 'http://x', NOW)).toMatchObject({
      state: 'down',
      reason: 'unexpected response',
    })
    expect(pipelineSnapshot({}, 'http://x', NOW)).toMatchObject({
      state: 'up',
      issues: [],
      downloads: [],
    })
  })
})

describe('arr view', () => {
  it('asks for setup with nothing configured', () => {
    const v = toView(
      [
        { app: 'radarr', state: 'unconfigured' },
        { app: 'pipeline', state: 'unconfigured' },
      ],
      NOW,
    )
    expect(v.setup?.message).toMatch(/^add at least one \*arr app/)
    expect(v.card).toBeUndefined()
    expect(toView([], NOW).setup).toBeDefined()
  })

  it('is plain and visible when all is healthy and idle', () => {
    const v = toView(
      [
        up('radarr', RADARR, { version: '5.14.0', missing: 3 }),
        up('sonarr', SONARR, { version: '4.0.11', airing: 2 }),
        up('bazarr', 'http://beebee:6767', {
          missingSubs: { movies: 4, episodes: 1 },
        }),
        { app: 'prowlarr', state: 'unconfigured' },
      ],
      NOW,
    )
    expect(v).toMatchObject({
      icon: 'clapperboard',
      tone: 'ok',
      label: null,
      click: { type: 'open', value: RADARR },
    })
    expect(v.hidden).toBeUndefined()
    expect(v.card).toMatchObject({ subtitle: 'all good', hint: null })
    expect(v.card?.rows).toEqual([
      {
        dot: 'ok',
        text: 'Radarr · 3 missing',
        hint: '5.14.0',
        action: { type: 'open', value: RADARR },
      },
      {
        dot: 'ok',
        text: 'Sonarr · 2 airing today',
        hint: '4.0.11',
        action: { type: 'open', value: SONARR },
      },
      {
        dot: 'ok',
        text: 'Bazarr · 4 movies, 1 episode without subs',
        hint: '1.2.3',
        action: { type: 'open', value: 'http://beebee:6767' },
      },
    ])
  })

  it('goes accent with a count while downloads are active', () => {
    const v = toView(
      [
        up('radarr', RADARR, {
          downloads: [dl('Slow', { progress: 8, eta: '1h 40m' }), dl('Fast')],
        }),
      ],
      NOW,
    )
    expect(v).toMatchObject({
      icon: 'clapperboard',
      tone: 'accent',
      label: '2',
    })
    expect(v.card?.subtitle).toBe('2 downloading')
    expect(v.card?.rows?.slice(0, 2)).toEqual([
      {
        dot: 'accent',
        text: 'Fast',
        hint: '42% · 12m',
        action: { type: 'open', value: `${RADARR}/activity/queue` },
      },
      {
        dot: 'accent',
        text: 'Slow',
        hint: '8% · 1h 40m',
        action: { type: 'open', value: `${RADARR}/activity/queue` },
      },
    ])
  })

  it('goes amber on a health warning and opens that app', () => {
    const issue: Issue = {
      app: 'sonarr',
      level: 'warn',
      text: 'Update available',
      link: 'https://wiki.servarr.com/x',
    }
    const v = toView(
      [up('radarr', RADARR), up('sonarr', SONARR, { issues: [issue] })],
      NOW,
    )
    expect(v).toMatchObject({
      icon: 'clapperboard',
      tone: 'warn',
      label: '1',
      click: { type: 'open', value: SONARR },
    })
    expect(v.card?.subtitle).toBe('1 issue')
    expect(v.card?.rows?.[0]).toEqual({
      dot: 'warn',
      text: 'Update available',
      hint: 'Sonarr',
      action: { type: 'open', value: 'https://wiki.servarr.com/x' },
    })
  })

  it('goes red on a blocked import, shown once with its reason', () => {
    const v = toView(
      [
        up('radarr', RADARR, {
          downloads: [
            dl('Fine'),
            dl('Blocked', {
              level: 'error',
              progress: 100,
              note: 'No files found',
            }),
          ],
        }),
      ],
      NOW,
    )
    expect(v).toMatchObject({
      icon: 'triangle-alert',
      tone: 'error',
      label: '1',
    })
    expect(v.card?.subtitle).toBe('1 issue · 1 downloading')
    expect(v.card?.rows?.map((r) => [r.dot, r.text, r.hint])).toEqual([
      ['error', 'Blocked', 'No files found'],
      ['accent', 'Fine', '42% · 12m'],
      ['ok', 'Radarr', '1.2.3'],
    ])
  })

  it('shows one app down and one with a bad key', () => {
    const v = toView(
      [
        {
          app: 'radarr',
          state: 'down',
          url: RADARR,
          reason: 'timeout',
          lastOkAt: NOW - 5 * MIN,
        },
        { app: 'sonarr', state: 'auth', url: SONARR, reason: '401' },
        up('prowlarr', 'http://beebee:9696'),
        { app: 'bazarr', state: 'misconfigured', reason: 'API key missing' },
      ],
      NOW,
    )
    expect(v).toMatchObject({
      icon: 'triangle-alert',
      tone: 'error',
      label: '3',
      click: { type: 'open', value: RADARR },
    })
    expect(v.setup).toBeUndefined()
    expect(v.card?.rows?.map((r) => [r.dot, r.text, r.hint])).toEqual([
      ['error', 'Radarr unreachable', 'Radarr'],
      ['error', 'Sonarr rejected the API key', 'Sonarr'],
      ['warn', 'Bazarr: API key missing', 'Bazarr'],
      ['error', 'Radarr', 'timeout · ok 5m ago'],
      ['error', 'Sonarr', '401'],
      ['ok', 'Prowlarr', '1.2.3'],
      ['muted', 'Bazarr', 'API key missing'],
    ])
    // A half-configured app has no URL to open.
    expect(v.card?.rows?.[2]?.action).toBeNull()
  })

  it('asks for setup when every configured app rejects its key', () => {
    const v = toView(
      [
        { app: 'radarr', state: 'auth', url: RADARR, reason: '401' },
        { app: 'sonarr', state: 'auth', url: SONARR, reason: '403' },
        { app: 'prowlarr', state: 'unconfigured' },
      ],
      NOW,
    )
    expect(v.setup?.message).toMatch(/^every app rejected its API key/)
    expect(v.card).toBeUndefined()
    expect(
      toView(
        [{ app: 'radarr', state: 'auth', url: RADARR, reason: '401' }],
        NOW,
      ).setup?.message,
    ).toMatch(/^Radarr rejected its API key/)
  })

  it('reports a low disk', () => {
    const issues = diskIssues(
      'radarr',
      [{ path: '/movies', freeSpace: 8 * GB }],
      [],
    )
    const v = toView([up('radarr', RADARR, { issues })], NOW)
    expect(v).toMatchObject({ tone: 'error', label: '1' })
    expect(v.card?.rows?.[0]).toMatchObject({
      dot: 'error',
      text: '8 GB free on /movies',
      hint: 'Radarr',
    })
  })

  it('lists pipeline failures with their reason and the running job', () => {
    const snap = pipelineSnapshot(
      {
        queue: { pending: 2, running: { path: '/in/Movie (2021).mkv' } },
        failures: [
          {
            path: '/m/Bad.mkv',
            reason: 'verify failed',
            time: new Date(NOW).toISOString(),
          },
        ],
        warnings: [
          {
            path: '/m/Subs.mkv',
            reason: 'no-forced-main-language',
            time: new Date(NOW).toISOString(),
          },
        ],
      },
      'http://beebee:9099/status.json',
      NOW,
    )
    expect(
      rows([up('radarr', RADARR), snap]).map((r) => [r.dot, r.text, r.hint]),
    ).toEqual([
      ['error', 'Bad.mkv', 'verify failed'],
      ['warn', 'Subs.mkv', 'no forced English subtitles'],
      ['accent', 'Converting Movie (2021).mkv', null],
      ['ok', 'Radarr', '1.2.3'],
      ['ok', 'Pipeline', '2 pending'],
    ])
    const down = toView(
      [
        up('radarr', RADARR),
        { app: 'pipeline', state: 'down', url: 'http://x', reason: 'timeout' },
      ],
      NOW,
    )
    expect(down.card?.rows?.[0]).toMatchObject({
      dot: 'error',
      text: 'Pipeline status unreachable',
    })
    // An app with a URL is the click target before the status file.
    expect(down.click).toEqual({ type: 'open', value: RADARR })
  })

  it('caps the card at 14 rows, keeps the app rows, and counts the rest', () => {
    const issues: Issue[] = Array.from({ length: 12 }, (_, i) => ({
      app: 'radarr',
      level: i % 2 ? 'error' : 'warn',
      text: `issue ${i}`,
    }))
    const downloads = Array.from({ length: 7 }, (_, i) => dl(`d${i}`))
    const v = toView(
      [
        up('radarr', RADARR, { issues, downloads }),
        up('sonarr', SONARR),
        up('prowlarr', 'http://beebee:9696'),
      ],
      NOW,
    )
    const r = v.card?.rows ?? []
    expect(r).toHaveLength(14)
    // 11 of 12 issues (errors first), no room for downloads, 3 app rows.
    expect(r.slice(0, 6).every((x) => x.dot === 'error')).toBe(true)
    expect(r.slice(6, 11).every((x) => x.dot === 'warn')).toBe(true)
    expect(r.slice(11).map((x) => x.text)).toEqual([
      'Radarr',
      'Sonarr',
      'Prowlarr',
    ])
    expect(v.card?.hint).toBe('+8 more')
    expect(v.label).toBe('12')

    // With room to spare, downloads still stop at five.
    const few = toView([up('radarr', RADARR, { downloads })], NOW)
    expect(few.card?.rows).toHaveLength(6)
    expect(few.card?.hint).toBe('+2 more')
  })
})
