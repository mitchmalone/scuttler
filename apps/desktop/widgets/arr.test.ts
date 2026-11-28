import { describe, expect, it } from 'vitest'

import {
  type AppSnapshot,
  type Download,
  type Issue,
  appSettings,
  calendarItems,
  diskIssues,
  englishGaps,
  eta,
  healthIssues,
  indexerIssues,
  libraryCount,
  manifest,
  middle,
  movieRanges,
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

describe('arr manifest', () => {
  it('declares each app as a service with a required URL and secret key', () => {
    const m = manifest()
    expect(m.id).toBe('arr')
    expect(m.services.map((s) => s.type)).toEqual([
      'radarr',
      'sonarr',
      'prowlarr',
      'bazarr',
    ])
    for (const svc of m.services) {
      const U = svc.type.toUpperCase()
      expect(
        svc.settings.map((s) => [s.key, s.required, 'secret' in s]),
      ).toEqual([
        [`${U}_URL`, true, false],
        [`${U}_API_KEY`, true, true],
      ])
    }
    expect(m.settings.map((s) => s.key)).toEqual(['PIPELINE_STATUS_URL'])
  })

  it('reads an app from its first service, else the old flat env', () => {
    const services = JSON.stringify([
      {
        id: 'radarr',
        type: 'radarr',
        label: 'Radarr',
        settings: { RADARR_URL: ' http://a ', RADARR_API_KEY: 'k1' },
      },
      {
        id: 'radarr-2',
        type: 'radarr',
        label: 'Radarr 2',
        settings: { RADARR_URL: 'http://b', RADARR_API_KEY: 'k2' },
      },
    ])
    expect(appSettings('radarr', services, {})).toEqual({
      url: 'http://a',
      key: 'k1',
    })
    expect(appSettings('sonarr', services, { SONARR_URL: 'http://s' })).toEqual(
      { url: '', key: '' },
    )
    expect(
      appSettings('sonarr', undefined, {
        SONARR_URL: 'http://s',
        SONARR_API_KEY: 'k',
      }),
    ).toEqual({ url: 'http://s', key: 'k' })
    expect(appSettings('bazarr', 'not json', {})).toEqual({ url: '', key: '' })
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
          text: 'Bad (2020): verify failed: audio stream count',
          hint: 'pipeline',
        },
        {
          app: 'pipeline',
          level: 'warn',
          text: 'Subs (2022): no forced English subs',
          hint: 'pipeline',
        },
      ],
      downloads: [
        { app: 'pipeline', title: 'Converting Movie (2021)', level: 'ok' },
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

/** Every row of a card, in order, tagged with its section ('' = top). */
const flat = (v: ReturnType<typeof toView>) => [
  ...(v.card?.rows ?? []).map((r) => ({ section: '', ...r })),
  ...(v.card?.sections ?? []).flatMap((s) =>
    s.rows.map((r) => ({ section: s.title ?? '', ...r })),
  ),
]
const brief = (v: ReturnType<typeof toView>) =>
  flat(v).map((r) => [r.section, r.dot, r.text, r.hint])

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

  it('is plain when idle: an empty library has only its footer', () => {
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
    expect(v.card).toMatchObject({
      subtitle: 'all good',
      rows: [],
      sections: [],
      footer: { left: '0 movies · 0 shows', right: '2.9 TB free' },
      hint: null,
    })
  })

  it('answers what is in flight, what is new and what is coming', () => {
    const v = toView(
      [
        up('radarr', RADARR, {
          library: 5,
          free: 3.5 * 1024 * GB,
          recent: [
            {
              app: 'radarr',
              key: 'movie:1',
              title: 'Eternals (2021)',
              at: NOW - 3 * 60 * MIN,
              badge: { text: '4K DV', tone: 'accent' },
              path: '/movie/eternals-2021',
            },
          ],
          upcoming: [
            {
              app: 'radarr',
              title: 'Dune: Part Three',
              at: NOW + 10 * 86_400_000,
              kind: 'digital',
              path: '/movie/dune-part-three',
            },
          ],
        }),
        up('sonarr', SONARR, {
          library: 2,
          downloads: [
            dl('Monarch S01E02 · Secrets and Lies', {
              app: 'sonarr',
              progress: 62,
              eta: '4m',
            }),
          ],
          recent: [
            {
              app: 'sonarr',
              key: 'episode:9',
              title: 'Monarch S01E01 · Aftermath',
              at: NOW - 30 * 60 * MIN,
              badge: { text: '1080p' },
              path: '/series/monarch',
            },
          ],
          upcoming: [
            {
              app: 'sonarr',
              title: 'Monarch S02E01',
              at: NOW + 2 * 86_400_000,
              path: '/series/monarch',
            },
          ],
        }),
      ],
      NOW,
    )
    // Downloading wins the cell's count; the subtitle says both.
    expect(v).toMatchObject({ tone: 'accent', label: '1' })
    expect(v.card?.subtitle).toMatch(/^1 downloading( · 1 new today)?$/)
    expect(v.card?.rows).toEqual([])
    expect(v.card?.sections?.map((s) => s.title)).toEqual([
      'In flight',
      'Recently added',
      'Coming up',
    ])
    expect(v.card?.sections?.[0]?.rows[0]).toEqual({
      dot: 'accent',
      text: 'Monarch S01E02 · Secrets and Lies',
      hint: '62% · 4m',
      progress: 62,
      action: { type: 'open', value: `${SONARR}/activity/queue` },
    })
    expect(v.card?.sections?.[1]?.rows).toEqual([
      {
        dot: 'ok',
        text: 'Eternals (2021)',
        hint: '3h',
        badge: { text: '4K DV', tone: 'accent' },
        action: { type: 'open', value: `${RADARR}/movie/eternals-2021` },
      },
      {
        dot: 'ok',
        text: 'Monarch S01E01 · Aftermath',
        hint: '1d',
        badge: { text: '1080p' },
        action: { type: 'open', value: `${SONARR}/series/monarch` },
      },
    ])
    expect(
      v.card?.sections?.[2]?.rows.map((r) => [r.dot, r.text, r.hint]),
    ).toEqual([
      [
        'muted',
        'Monarch S02E01',
        expect.stringMatching(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/),
      ],
      ['muted', 'Dune: Part Three', 'digital · 3 Dec'],
    ])
    expect(v.card?.footer).toEqual({
      left: '5 movies · 2 shows',
      right: '3.5 TB free',
    })
  })

  it('counts imports since midnight as new', () => {
    const midnight = new Date(NOW)
    midnight.setHours(0, 0, 0, 0)
    const at = midnight.getTime() + 60_000
    const v = toView(
      [
        up('radarr', RADARR, {
          recent: [{ app: 'radarr', key: 'movie:1', title: 'X', at }],
        }),
      ],
      NOW,
    )
    expect(v).toMatchObject({ tone: 'accent', label: '1' })
    expect(v.card?.subtitle).toBe('1 new today')
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
    expect(brief(v)).toEqual([
      ['In flight', 'accent', 'Fast', '42% · 12m'],
      ['In flight', 'accent', 'Slow', '8% · 1h 40m'],
    ])
  })

  it('goes amber on a health warning, on top, and opens that app', () => {
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

  it('goes red on a blocked import, shown in flight with its reason', () => {
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
    expect(brief(v)).toEqual([
      ['In flight', 'error', 'Blocked', 'No files found'],
      ['In flight', 'accent', 'Fine', '42% · 12m'],
    ])
    // Only a healthy download draws a bar.
    expect(flat(v)[0]?.progress).toBeNull()
  })

  it('shows one app down and one with a bad key, as issues only', () => {
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
    expect(brief(v)).toEqual([
      ['', 'error', 'Radarr unreachable', 'timeout · ok 5m ago'],
      ['', 'error', 'Sonarr rejected the API key', 'Configure'],
      ['', 'warn', 'Bazarr: API key missing', 'Configure'],
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

  it('lists pipeline problems on top and the running job in flight', () => {
    const snap = pipelineSnapshot(
      {
        queue: {
          pending: 2,
          running: { path: '/in/The Bear S03E01.mkv', stage: 'verify' },
        },
        warnings: [
          {
            path: '/m/Shang-Chi (2021).mkv',
            reason: 'no-forced-main-language',
            time: new Date(NOW).toISOString(),
          },
        ],
      },
      'http://beebee:9099/status.json',
      NOW,
    )
    expect(brief(toView([up('radarr', RADARR), snap], NOW))).toEqual([
      ['', 'warn', 'Shang-Chi (2021): no forced English subs', 'pipeline'],
      ['In flight', 'accent', 'Converting The Bear S03E01', 'verify…'],
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
    const r = flat(v)
    expect(r).toHaveLength(14)
    // All 12 issues (errors first), then two downloads; no room for imports.
    expect(r.slice(0, 6).every((x) => x.dot === 'error')).toBe(true)
    expect(r.slice(6, 12).every((x) => x.dot === 'warn')).toBe(true)
    expect(r.slice(12).map((x) => [x.section, x.text])).toEqual([
      ['In flight', 'd0'],
      ['In flight', 'd1'],
    ])
    expect(v.card?.hint).toBe('+5 more')
    expect(v.label).toBe('12')

    // With room to spare, downloads still stop at five; the import follows.
    const few = toView([up('radarr', RADARR, { downloads, recent })], NOW)
    expect(flat(few)).toHaveLength(6)
    expect(flat(few)[5]).toMatchObject({
      section: 'Recently added',
      text: 'New',
      hint: '3d',
    })
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
        badge: { text: '4K DV', tone: 'accent' },
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
      recentImports('sonarr', sonarr, NOW).map((r) => [r.title, r.badge?.text]),
    ).toEqual([
      ['Monarch S01E02', undefined],
      ['Monarch S01E01 · Aftermath', '1080p'],
    ])
  })

  it('takes the dynamic range from the movie list when history lacks the file', () => {
    // Radarr's history includes the movie but not its file (seen live).
    const history = {
      records: [
        {
          movieId: 3,
          date: iso(NOW - 60 * MIN),
          quality: { quality: { resolution: 2160 } },
          movie: { id: 3, title: 'Eternals', year: 2021, titleSlug: '524434' },
        },
      ],
    }
    const ranges = movieRanges([
      {
        id: 3,
        movieFile: { mediaInfo: { videoDynamicRangeType: 'DV HDR10Plus' } },
      },
      { id: 4, movieFile: { mediaInfo: { videoDynamicRangeType: '' } } },
    ])
    expect(ranges).toEqual({ '3': 'DV HDR10Plus' })
    expect(recentImports('radarr', history, NOW, ranges)[0]?.badge).toEqual({
      text: '4K DV',
      tone: 'accent',
    })
    expect(recentImports('radarr', history, NOW)[0]?.badge).toEqual({
      text: '4K',
      tone: 'accent',
    })
  })

  it('badges resolution and dynamic range', () => {
    const q = (resolution: number) => ({ quality: { resolution } })
    expect(qualityBadge(q(2160), { videoDynamicRangeType: 'HDR10' })).toEqual({
      text: '4K HDR',
      tone: 'accent',
    })
    expect(qualityBadge(q(1080), { videoDynamicRangeType: 'DV' })).toEqual({
      text: '1080p DV',
      tone: 'accent',
    })
    // Plain HD is not worth a colour.
    expect(qualityBadge(q(720))).toEqual({ text: '720p' })
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
        text: 'Monarch S01E04 aired, not grabbed',
        hint: 'Sonarr · 2d',
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
        title: 'Dune: Part Three',
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
