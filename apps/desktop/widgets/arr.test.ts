import { describe, expect, it } from 'vitest'

import {
  type AppSnapshot,
  type Download,
  type Issue,
  calendarItems,
  diskIssues,
  englishGaps,
  eta,
  healthIssues,
  indexerIssues,
  libraryCount,
  manifest,
  middle,
  normalizeUrl,
  pipelineSnapshot,
  qualityBadge,
  queueDownloads,
  recentImports,
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

  it('is plain when idle: nothing new, nothing in flight, no problems', () => {
    const v = toView(
      [
        up('radarr', RADARR, { library: 0, free: 2.9 * 1024 * GB }),
        up('sonarr', SONARR, { library: 0 }),
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
    // An empty library: no rows at all, no app rows with versions.
    expect(v.card).toMatchObject({
      subtitle: 'all good',
      rows: [],
      hint: '0 movies · 0 shows · 2.9 TB free',
    })
  })

  it('shows what is new and what is coming when all is well', () => {
    const v = toView(
      [
        up('radarr', RADARR, {
          library: 5,
          free: 2.9 * 1024 * GB,
          recent: [
            {
              app: 'radarr',
              key: 'movie:1',
              title: 'Eternals (2021)',
              at: NOW - 2 * 60 * MIN,
              badge: '4K DV',
              path: '/movie/eternals-2021',
            },
          ],
          upcoming: [
            {
              app: 'radarr',
              title: 'Dune: Part Three (2026)',
              at: NOW + 10 * 86_400_000,
              kind: 'digital',
              path: '/movie/dune-part-three-2026',
            },
          ],
        }),
        up('sonarr', SONARR, {
          library: 2,
          recent: [
            {
              app: 'sonarr',
              key: 'episode:9',
              title: 'Monarch S01E01 · Aftermath',
              at: NOW - 30 * 60 * MIN,
              badge: '1080p',
              path: '/series/monarch',
            },
          ],
          upcoming: [
            {
              app: 'sonarr',
              title: 'Monarch S01E05',
              at: NOW + 2 * 86_400_000,
              path: '/series/monarch',
            },
          ],
        }),
      ],
      NOW,
    )
    // One import in the last day: accent with a count.
    expect(v).toMatchObject({ tone: 'accent', label: '1' })
    expect(v.card?.subtitle).toBe('1 new')
    expect(v.card?.hint).toBe('5 movies · 2 shows · 2.9 TB free')
    expect(v.card?.rows).toEqual([
      {
        dot: 'ok',
        text: 'Eternals (2021)',
        hint: '2h · 4K DV',
        action: { type: 'open', value: `${RADARR}/movie/eternals-2021` },
      },
      {
        dot: 'ok',
        text: 'Monarch S01E01 · Aftermath',
        hint: '1d · 1080p',
        action: { type: 'open', value: `${SONARR}/series/monarch` },
      },
      {
        dot: 'muted',
        text: 'Monarch S01E05',
        hint: expect.stringMatching(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/),
        action: { type: 'open', value: `${SONARR}/series/monarch` },
      },
      {
        dot: 'muted',
        text: 'Dune: Part Three (2026)',
        hint: 'digital · 3 Dec',
        action: {
          type: 'open',
          value: `${RADARR}/movie/dune-part-three-2026`,
        },
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
      ['error', 'Radarr unreachable', 'timeout · ok 5m ago'],
      ['error', 'Sonarr rejected the API key', 'Configure'],
      ['warn', 'Bazarr: API key missing', 'Configure'],
    ])
    // A half-configured app is fixed in Settings, not in the app.
    expect(v.card?.rows?.[2]?.action).toEqual({
      type: 'settings',
      value: 'widgets',
    })
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

  it('caps the card at 14 rows: issues first, then in flight', () => {
    const issues: Issue[] = Array.from({ length: 12 }, (_, i) => ({
      app: 'radarr',
      level: i % 2 ? 'error' : 'warn',
      text: `issue ${i}`,
    }))
    const downloads = Array.from({ length: 7 }, (_, i) => dl(`d${i}`))
    const recent = [
      {
        app: 'radarr' as const,
        key: 'movie:1',
        title: 'New',
        at: NOW - 3 * 86_400_000,
      },
    ]
    const v = toView(
      [
        up('radarr', RADARR, { issues, downloads, recent }),
        up('sonarr', SONARR),
      ],
      NOW,
    )
    const r = v.card?.rows ?? []
    expect(r).toHaveLength(14)
    // All 12 issues (errors first), then two downloads; no room for imports.
    expect(r.slice(0, 6).every((x) => x.dot === 'error')).toBe(true)
    expect(r.slice(6, 12).every((x) => x.dot === 'warn')).toBe(true)
    expect(r.slice(12).map((x) => x.text)).toEqual(['d0', 'd1'])
    expect(v.card?.hint).toBe('+5 more')
    expect(v.label).toBe('12')

    // With room to spare, downloads still stop at five; the import follows.
    const few = toView([up('radarr', RADARR, { downloads, recent })], NOW)
    expect(few.card?.rows).toHaveLength(6)
    expect(few.card?.rows?.[5]).toMatchObject({ text: 'New', hint: '3d' })
    expect(few.card?.hint).toBe('+2 more')
  })
})

describe('arr v2 sources', () => {
  const iso = (ms: number) => new Date(ms).toISOString()

  it('reads Radarr and Sonarr import history, newest first, deduped', () => {
    const radarr = {
      records: [
        {
          movieId: 1,
          date: iso(NOW - 2 * 60 * MIN),
          quality: { quality: { resolution: 2160 } },
          movie: {
            title: 'Eternals',
            year: 2021,
            titleSlug: 'eternals-2021',
            movieFile: { mediaInfo: { videoDynamicRangeType: 'DV HDR10' } },
          },
        },
        // The same movie imported again (an upgrade): shown once.
        {
          movieId: 1,
          date: iso(NOW - 5 * 60 * MIN),
          movie: { title: 'Eternals', year: 2021 },
        },
        // Older than a week: dropped.
        {
          movieId: 2,
          date: iso(NOW - 9 * 86_400_000),
          movie: { title: 'Old', year: 1999 },
        },
      ],
    }
    expect(recentImports('radarr', radarr, NOW)).toEqual([
      {
        app: 'radarr',
        key: 'movie:1',
        title: 'Eternals (2021)',
        at: NOW - 2 * 60 * MIN,
        badge: '4K DV',
        path: '/movie/eternals-2021',
      },
    ])
    const sonarr = {
      records: [
        {
          episodeId: 7,
          date: iso(NOW - 60 * MIN),
          quality: { quality: { resolution: 1080 } },
          series: { title: 'Monarch', titleSlug: 'monarch' },
          episode: { seasonNumber: 1, episodeNumber: 1, title: 'Aftermath' },
        },
        {
          episodeId: 8,
          date: iso(NOW - 30 * MIN),
          series: { title: 'Monarch', titleSlug: 'monarch' },
          episode: { seasonNumber: 1, episodeNumber: 2, title: 'TBA' },
        },
      ],
    }
    expect(
      recentImports('sonarr', sonarr, NOW).map((r) => [r.title, r.badge]),
    ).toEqual([
      ['Monarch S01E02', undefined],
      ['Monarch S01E01 · Aftermath', '1080p'],
    ])
  })

  it('badges resolution and dynamic range', () => {
    const q = (resolution: number) => ({ quality: { resolution } })
    expect(qualityBadge(q(2160), { videoDynamicRangeType: 'HDR10' })).toBe(
      '4K HDR',
    )
    expect(qualityBadge(q(720))).toBe('720p')
    expect(qualityBadge(undefined)).toBeUndefined()
  })

  it('splits the calendar into coming up and aired, not grabbed', () => {
    const sonarr = [
      {
        airDateUtc: iso(NOW + 2 * 86_400_000),
        seasonNumber: 1,
        episodeNumber: 5,
        hasFile: false,
        monitored: true,
        series: { title: 'Monarch', titleSlug: 'monarch' },
      },
      // Aired two days ago, no file: past due.
      {
        airDateUtc: iso(NOW - 2 * 86_400_000),
        seasonNumber: 1,
        episodeNumber: 4,
        hasFile: false,
        monitored: true,
        series: { title: 'Monarch', titleSlug: 'monarch' },
      },
      // Aired an hour ago: still within the grace day.
      {
        airDateUtc: iso(NOW - 60 * MIN),
        seasonNumber: 1,
        episodeNumber: 6,
        hasFile: false,
        series: { title: 'Monarch' },
      },
      // Already grabbed.
      {
        airDateUtc: iso(NOW - 3 * 86_400_000),
        seasonNumber: 1,
        episodeNumber: 3,
        hasFile: true,
        series: { title: 'Monarch' },
      },
    ]
    const cal = calendarItems('sonarr', sonarr, NOW)
    expect(cal.upcoming.map((u) => u.title)).toEqual(['Monarch S01E05'])
    expect(cal.late).toEqual([
      {
        app: 'sonarr',
        level: 'warn',
        text: 'Monarch S01E04',
        hint: 'aired, not grabbed',
        link: '/series/monarch',
      },
    ])
    // A past-due row opens the series in Sonarr.
    const v = toView([up('sonarr', SONARR, { issues: cal.late })], NOW)
    expect(v.card?.rows?.[0]?.action).toEqual({
      type: 'open',
      value: `${SONARR}/series/monarch`,
    })

    const radarr = [
      {
        title: 'Dune: Part Three',
        year: 2026,
        titleSlug: 'dune',
        inCinemas: iso(NOW - 30 * 86_400_000),
        digitalRelease: iso(NOW + 10 * 86_400_000),
        physicalRelease: iso(NOW + 40 * 86_400_000),
        hasFile: false,
        monitored: true,
      },
    ]
    expect(calendarItems('radarr', radarr, NOW).upcoming).toEqual([
      {
        app: 'radarr',
        title: 'Dune: Part Three (2026)',
        at: NOW + 10 * 86_400_000,
        kind: 'digital',
        path: '/movie/dune',
      },
    ])
  })

  it('counts only full English subtitle gaps, never forced-only ones', () => {
    const forcedOnly = {
      data: [
        {
          title: 'Spider-Man',
          missing_subtitles: [{ code2: 'en', forced: true, hi: false }],
        },
        { title: 'Eternals', missing_subtitles: ['en:forced'] },
      ],
    }
    expect(englishGaps(forcedOnly)).toBe(0)
    const full = {
      data: [
        {
          title: 'Monarch',
          missing_subtitles: [{ code2: 'en', forced: false, hi: false }],
        },
        { title: 'Other', missing_subtitles: ['en'] },
        {
          title: 'French',
          missing_subtitles: [{ code2: 'fr', forced: false }],
        },
      ],
    }
    expect(englishGaps(full)).toBe(2)
  })

  it('counts movies with a file and series with an episode file', () => {
    expect(
      libraryCount('radarr', [{ hasFile: true }, { hasFile: false }, {}]),
    ).toBe(1)
    expect(
      libraryCount('sonarr', [
        { statistics: { episodeFileCount: 3 } },
        { statistics: { episodeFileCount: 0 } },
      ]),
    ).toBe(1)
  })
})
