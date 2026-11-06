import { defineStories } from '@scuttler/tui'
import { NOOP_HOST } from '@scuttler/tui/plugins'

import {
  UPDATES_PLUGIN,
  idleUpdatesReportAt,
  updatesReportAt,
} from './fixtures'
import type { UpdatesReport } from './model'
import UpdatesPanel from './panel'

const noop = () => {}

/* The panel ticks "checked N ago" off the real clock, so the report is
 * stamped at render time rather than at the fixture's fixed instant. */
const nowSecs = () => Math.floor(Date.now() / 1000)

function panel(state: UpdatesReport | null) {
  return (
    <UpdatesPanel
      plugin={{ ...UPDATES_PLUGIN, state }}
      state={state}
      settings={{}}
      host={NOOP_HOST}
      onClose={noop}
    />
  )
}

export const updatesPanelStories = defineStories('UpdatesPanel (plugin)', [
  {
    name: 'pending updates, nothing running',
    notes:
      'The ledger: a band per manager with its count and upgrade-all, packages under the gutter; pnpm folded, mise’s check failed.',
    keys: '↑↓ row · ⏎ upgrade · u upgrade all in group · a everything · t terminal · c copy · r refresh · esc back',
    render: () => panel(idleUpdatesReportAt(nowSecs())),
  },
  {
    name: 'batch running: gcc upgrading, vips queued',
    notes:
      'The run block at the top: one meter line and the last output line. Rows read upgrading / queued.',
    keys: 'x cancel · ⏎ queue · esc back',
    render: () => panel(updatesReportAt(nowSecs())),
  },
  {
    name: 'App Store waits on the approval sheet',
    notes:
      'mas needs root. `a` queued Homebrew at once and put the system sheet up for the App Store job: Touch ID, Apple Watch or password. Approved, it joins the queue as `sudo -n`; declined, the line says so.',
    keys: 'approve on the sheet · x cancel the running job',
    render: () => {
      const t = nowSecs()
      const r = updatesReportAt(t)
      return panel({
        ...r,
        approval: { state: 'pending', sources: ['mas'], detail: '', at: t - 3 },
      })
    },
  },
  {
    name: 'App Store needs setup once',
    notes:
      'No sudoers rule names mas yet: its band says what to run once (`scuttler sudoers on`, one admin password), `c` copies it, ↵ runs nothing. Everything else upgrades as usual.',
    keys: 'c copy the setup command · t terminal',
    render: () => {
      const t = nowSecs()
      const r = idleUpdatesReportAt(t)
      return panel({
        ...r,
        sources: r.sources.map((s) =>
          s.id === 'mas' ? { ...s, admin: 'needsRule' as const } : s,
        ),
        approval: {
          state: 'declined',
          sources: ['mas'],
          detail: 'not approved',
          at: t - 5,
        },
      })
    },
  },
  {
    name: 'batch finished: one upgraded, one failed',
    render: () => {
      const t = nowSecs()
      const r = updatesReportAt(t)
      return panel({
        ...r,
        upgrade: {
          source: 'brew',
          item: 'vips',
          command: 'brew upgrade vips',
          startedAt: t - 20,
          finishedAt: t - 2,
          exitCode: 1,
          cancelled: false,
          tail: ['==> Fetching vips', 'Error: vips: checksum mismatch'],
        },
        queue: [],
        recent: [
          {
            ...r.upgrade!,
            finishedAt: t - 21,
            exitCode: 0,
            tail: [...r.upgrade!.tail, '==> Upgraded gcc 16.1.0 -> 16.2.0'],
          },
        ],
        batch: { done: 2, total: 2, failed: 1, startedAt: t - 30 },
      })
    },
  },
  {
    name: 'one package dismissed for a day',
    notes:
      'beeper/tap/cli failed, then `d`: it leaves the count and closes Homebrew’s group as a dim row with its time left; ↵ restores it. Homebrew’s command is now its pending packages’ own.',
    keys: 'd dismiss 24h / restore · ↵ restore',
    render: () => {
      const t = nowSecs()
      const r = idleUpdatesReportAt(t)
      const brew = r.sources[0]!
      return panel({
        ...r,
        sources: [
          {
            ...brew,
            upgradeCommand: brew.items
              .map((i) => i.upgradeCommand)
              .join(' && '),
            dismissed: [
              {
                name: 'beeper/tap/cli',
                installed: '0.6.2',
                available: '0.6.3',
                upgradeCommand: 'brew upgrade beeper/tap/cli',
                dismissedUntil: t + 23 * 3600 + 600,
              },
            ],
          },
          ...r.sources.slice(1),
        ],
      })
    },
  },
  {
    name: 'refreshing',
    render: () =>
      panel({ ...idleUpdatesReportAt(nowSecs()), refreshing: true }),
  },
  {
    name: 'everything up to date',
    render: () => {
      const r = idleUpdatesReportAt(nowSecs())
      return panel({
        ...r,
        sources: r.sources.map((s) => ({ ...s, items: [], error: null })),
      })
    },
  },
  {
    name: 'before the first check',
    render: () => panel(null),
  },
])
