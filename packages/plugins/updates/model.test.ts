import { describe, expect, it } from 'vitest'

import {
  GROUP_CAP,
  type UpdateSource,
  type UpdatesReport,
  type UpgradeRun,
  batchFailures,
  batchHeadline,
  batchLine,
  batchProgress,
  cappedItems,
  cellTone,
  cellVisible,
  checkedAgo,
  countLine,
  dismissedItems,
  dismissedLeft,
  duration,
  failedRun,
  hasErrors,
  headline,
  lastLine,
  ledgerRows,
  rowCommand,
  rowDismissMessage,
  rowSelectable,
  rowUpgradeMessage,
  sourceHeadline,
  sourceLine,
  totalDismissed,
  totalUpdates,
  upgradeBusy,
  upgradeFailed,
  upgradeLine,
  upgradeRunning,
  upgradeStatus,
  upgradeTarget,
} from './model'

const T = 1_800_000_000

const cleanSource: UpdateSource = {
  id: 'pnpm',
  label: 'pnpm',
  upgradeCommand: 'pnpm update -g',
  checkedAt: T,
  error: null,
  items: [],
}

const brewSource: UpdateSource = {
  id: 'brew',
  label: 'Homebrew',
  upgradeCommand: 'brew upgrade',
  checkedAt: T,
  error: null,
  items: [
    {
      name: 'gcc',
      installed: '16.1.0',
      available: '16.2.0',
      upgradeCommand: 'brew upgrade gcc',
    },
    {
      name: 'vips',
      installed: '8.18.5_1',
      available: '8.18.6',
      upgradeCommand: 'brew upgrade vips',
    },
    {
      name: 'repobar',
      installed: '0.6.1',
      available: '0.8.7',
      kind: 'cask',
      upgradeCommand: 'brew upgrade --cask repobar',
    },
  ],
}

const masSource: UpdateSource = {
  id: 'mas',
  label: 'App Store',
  upgradeCommand: 'mas upgrade',
  checkedAt: T,
  error: null,
  items: [
    {
      name: 'Xcode',
      installed: '26.0',
      available: '26.1',
      upgradeCommand: 'mas upgrade 497799835',
    },
  ],
}

const miseSource: UpdateSource = {
  id: 'mise',
  label: 'mise',
  upgradeCommand: 'mise upgrade',
  checkedAt: T,
  error: 'registry timed out',
  items: [],
}

/** brew as `updates.rs` reports it once `beeper/tap/cli` is dismissed: out of
 * `items`, into `dismissed`, the source's command reduced to what is pending. */
const brewWithDismissed: UpdateSource = {
  ...brewSource,
  upgradeCommand: 'brew upgrade gcc && brew upgrade vips',
  items: brewSource.items.filter((i) => i.name !== 'repobar'),
  dismissed: [
    {
      name: 'beeper/tap/cli',
      installed: '0.6.2',
      available: '0.6.3',
      upgradeCommand: 'brew upgrade beeper/tap/cli',
      dismissedUntil: T + 23 * 3600,
    },
  ],
}

function report(overrides: Partial<UpdatesReport> = {}): UpdatesReport {
  return {
    generatedAt: T,
    refreshing: false,
    sources: [brewSource, masSource, cleanSource, miseSource],
    ...overrides,
  }
}

const run = (overrides: Partial<UpgradeRun> = {}): UpgradeRun => ({
  source: 'brew',
  item: null,
  command: 'brew upgrade',
  startedAt: T,
  finishedAt: 0,
  exitCode: null,
  cancelled: false,
  tail: [],
  ...overrides,
})

describe('updates model', () => {
  describe('totalUpdates / countLine', () => {
    it('sums items across every source', () => {
      expect(totalUpdates(report())).toBe(4)
      expect(countLine(4)).toBe('4 updates')
      expect(countLine(1)).toBe('1 update')
    })

    it('is zero when every source is clean', () => {
      expect(totalUpdates(report({ sources: [cleanSource] }))).toBe(0)
      expect(countLine(0)).toBe('up to date')
    })
  })

  describe('hasErrors', () => {
    it('is true when any source errored', () => {
      expect(hasErrors(report())).toBe(true)
    })

    it('is false when no source errored', () => {
      expect(hasErrors(report({ sources: [brewSource, cleanSource] }))).toBe(
        false,
      )
    })
  })

  describe('cellVisible', () => {
    it('is hidden for a null report', () => {
      expect(cellVisible(null)).toBe(false)
    })

    it('is hidden when generatedAt is 0 (never checked)', () => {
      expect(cellVisible(report({ generatedAt: 0 }))).toBe(false)
    })

    it('is hidden when every source is clean and error-free', () => {
      expect(cellVisible(report({ sources: [cleanSource] }))).toBe(false)
    })

    it('stays while an upgrade runs, even with nothing left pending', () => {
      expect(
        cellVisible(report({ sources: [cleanSource], upgrade: run() })),
      ).toBe(true)
    })

    it('is visible when a source has updates', () => {
      expect(cellVisible(report({ sources: [brewSource] }))).toBe(true)
    })

    it('is visible when a source errored, even with no updates', () => {
      expect(cellVisible(report({ sources: [miseSource] }))).toBe(true)
    })
  })

  describe('cellTone', () => {
    it('is warn when any source errored', () => {
      expect(cellTone(report())).toBe('warn')
    })

    it('is normal when nothing errored', () => {
      expect(cellTone(report({ sources: [brewSource] }))).toBe('normal')
    })
  })

  describe('sourceLine', () => {
    it('shows the count when updates exist', () => {
      expect(sourceLine(brewSource)).toBe('Homebrew · 3')
    })

    it('shows "up to date" when clean', () => {
      expect(sourceLine(cleanSource)).toBe('pnpm · up to date')
    })

    it('shows the error when a source errored', () => {
      expect(sourceLine(miseSource)).toBe('mise · error: registry timed out')
    })
  })

  describe('checkedAgo', () => {
    it('says never checked at 0', () => {
      expect(checkedAgo(0, T + 100)).toBe('never checked')
    })

    it('says just now under a minute', () => {
      expect(checkedAgo(T, T + 30)).toBe('checked just now')
    })

    it('says minutes under an hour', () => {
      expect(checkedAgo(T, T + 720)).toBe('checked 12 min ago')
    })

    it('says hours at or beyond an hour', () => {
      expect(checkedAgo(T, T + 10_800)).toBe('checked 3 h ago')
    })
  })

  describe('ledgerRows', () => {
    it('is a band per source, its items sorted by name, clean sources folded', () => {
      const rows = ledgerRows(report())
      expect(rows.map((r) => r.kind)).toEqual([
        'band',
        'item',
        'item',
        'item',
        'band',
        'item',
        'clean',
        'band',
        'error',
      ])
      expect(
        rows.flatMap((r) => (r.kind === 'item' ? [r.item.name] : [])),
      ).toEqual(['gcc', 'repobar', 'vips', 'Xcode'])
      expect(rows[6]).toEqual({ kind: 'clean', source: cleanSource })
      expect(rows[8]).toEqual({
        kind: 'error',
        source: miseSource,
        error: 'registry timed out',
      })
    })

    it('caps a long group with a "+N more" row until expanded', () => {
      const many: UpdateSource = {
        ...brewSource,
        items: Array.from({ length: GROUP_CAP + 5 }, (_, i) => ({
          name: `pkg-${String(i).padStart(2, '0')}`,
          installed: '1',
          available: '2',
          upgradeCommand: `brew upgrade pkg-${i}`,
        })),
      }
      const capped = ledgerRows(report({ sources: [many] }))
      expect(capped.filter((r) => r.kind === 'item')).toHaveLength(GROUP_CAP)
      expect(capped.at(-1)).toMatchObject({ kind: 'more', hidden: 5 })
      const open = ledgerRows(report({ sources: [many] }), new Set(['brew']))
      expect(open.filter((r) => r.kind === 'item')).toHaveLength(GROUP_CAP + 5)
      expect(open.some((r) => r.kind === 'more')).toBe(false)
    })

    it('only items, the more row and an error row take the cursor', () => {
      for (const row of ledgerRows(report())) {
        expect(rowSelectable(row)).toBe(
          row.kind === 'item' || row.kind === 'more' || row.kind === 'error',
        )
      }
    })

    it('a row knows its command and its message', () => {
      const [band, gcc] = ledgerRows(report({ sources: [brewSource] }))
      expect(rowCommand(band!)).toBe('brew upgrade')
      expect(rowUpgradeMessage(band!)).toEqual({ upgrade: 'brew' })
      expect(rowCommand(gcc!)).toBe('brew upgrade gcc')
      expect(rowUpgradeMessage(gcc!)).toEqual({ upgrade: 'brew', item: 'gcc' })
      const [, err] = ledgerRows(report({ sources: [miseSource] }))
      expect(rowUpgradeMessage(err!)).toEqual({ upgrade: 'mise' })
      expect(
        rowUpgradeMessage({ kind: 'clean', source: cleanSource }),
      ).toBeNull()
      expect(
        rowUpgradeMessage({ kind: 'more', source: brewSource, hidden: 3 }),
      ).toBeNull()
    })

    it('headline counts updates and the managers holding them', () => {
      expect(headline(report())).toBe('4 updates · 2 managers')
      expect(headline(report({ sources: [masSource] }))).toBe(
        '1 update · 1 manager',
      )
      expect(headline(report({ sources: [cleanSource] }))).toBe('up to date')
    })
  })

  describe('cappedItems', () => {
    it('caps the list and counts the rest', () => {
      expect(cappedItems(brewSource, 2)).toMatchObject({
        shown: [{ name: 'gcc' }, { name: 'repobar' }],
        more: 1,
      })
      expect(cappedItems(brewSource, 5).more).toBe(0)
    })
  })

  describe('upgradeStatus', () => {
    it('is idle with nothing running', () => {
      expect(upgradeStatus(report(), 'brew', 'gcc')).toBe('idle')
      expect(upgradeStatus(report(), 'brew')).toBe('idle')
    })

    it('is running for the current job and everything a source job covers', () => {
      const r = report({
        upgrade: run({ item: 'gcc', command: 'brew upgrade gcc' }),
      })
      expect(upgradeStatus(r, 'brew', 'gcc')).toBe('running')
      expect(upgradeStatus(r, 'brew', 'vips')).toBe('idle')
      expect(upgradeStatus(r, 'brew')).toBe('running')
      const whole = report({ upgrade: run() })
      expect(upgradeStatus(whole, 'brew', 'vips')).toBe('running')
      expect(upgradeStatus(whole, 'mas', 'Xcode')).toBe('idle')
    })

    it('is queued while a job waits', () => {
      const r = report({
        upgrade: run({ item: 'gcc' }),
        queue: [
          { source: 'brew', item: 'vips', command: 'brew upgrade vips' },
          { source: 'mas', item: null, command: 'mas upgrade' },
        ],
      })
      expect(upgradeStatus(r, 'brew', 'vips')).toBe('queued')
      expect(upgradeStatus(r, 'mas', 'Xcode')).toBe('queued')
      expect(upgradeStatus(r, 'mas')).toBe('queued')
      expect(upgradeBusy(r)).toBe(true)
    })

    it('keeps failed across a re-check, clears done once the source is re-checked', () => {
      const done = run({ item: 'gcc', finishedAt: T + 10, exitCode: 0 })
      const failed = run({ item: 'vips', finishedAt: T + 20, exitCode: 1 })
      const r = report({ upgrade: failed, recent: [done] })
      expect(upgradeStatus(r, 'brew', 'gcc')).toBe('done')
      expect(upgradeStatus(r, 'brew', 'vips')).toBe('failed')
      expect(upgradeStatus(r, 'brew', 'repobar')).toBe('idle')
      const rechecked = report({
        upgrade: failed,
        recent: [done],
        sources: [{ ...brewSource, checkedAt: T + 30 }],
      })
      expect(upgradeStatus(rechecked, 'brew', 'gcc')).toBe('idle')
      expect(upgradeStatus(rechecked, 'brew', 'vips')).toBe('failed')
      expect(failedRun(rechecked, 'brew', 'vips')).toBe(failed)
      expect(failedRun(rechecked, 'brew', 'gcc')).toBeNull()
    })

    it('a cancelled run leaves the row idle', () => {
      const r = report({
        upgrade: run({ item: 'gcc', finishedAt: T + 10, cancelled: true }),
      })
      expect(upgradeStatus(r, 'brew', 'gcc')).toBe('idle')
    })
  })

  describe('sourceHeadline', () => {
    it('prefers the runner status, then error, clean, count', () => {
      expect(sourceHeadline(report(), brewSource)).toEqual({
        text: '3',
        status: 'pending',
      })
      expect(sourceHeadline(report(), cleanSource)).toEqual({
        text: 'up to date',
        status: 'clean',
      })
      expect(sourceHeadline(report(), miseSource)).toEqual({
        text: 'check failed',
        status: 'error',
      })
      expect(
        sourceHeadline(report({ upgrade: run({ item: 'gcc' }) }), brewSource),
      ).toEqual({ text: 'upgrading…', status: 'running' })
    })
  })

  describe('batch', () => {
    it('is null until something was queued', () => {
      expect(batchProgress(report())).toBeNull()
      expect(batchProgress(report({ batch: { done: 0, total: 0 } }))).toBeNull()
      expect(batchProgress(report({ batch: { done: 1, total: 3 } }))).toEqual({
        done: 1,
        total: 3,
      })
      expect(batchLine({ done: 1, total: 3 })).toBe('1 of 3')
      expect(batchLine({ done: 4, total: 3 })).toBe('3 of 3')
      expect(batchLine({ done: 3, total: 3, failed: 1 })).toBe(
        '3 of 3 · 1 failed',
      )
    })

    it('headlines a finished batch with who failed', () => {
      const brewFail = run({
        finishedAt: T + 3,
        startedAt: T + 1,
        exitCode: 1,
        tail: ['Error: bin/beeper'],
      })
      const masOk = run({
        source: 'mas',
        command: 'mas upgrade',
        startedAt: T + 3,
        finishedAt: T + 4,
        exitCode: 0,
      })
      const miseOk = run({
        source: 'mise',
        command: 'mise upgrade',
        startedAt: T + 4,
        finishedAt: T + 9,
        exitCode: 0,
      })
      const batch = { done: 3, total: 3, failed: 1, startedAt: T + 1 }
      const r = report({ upgrade: miseOk, recent: [brewFail, masOk], batch })
      expect(batchFailures(r)).toEqual([brewFail])
      expect(batchHeadline(r, batch)).toBe('2 upgraded · Homebrew failed')
      expect(lastLine(brewFail)).toBe('Error: bin/beeper')
      const clean = report({
        upgrade: miseOk,
        recent: [masOk],
        batch: { ...batch, failed: 0 },
      })
      expect(batchHeadline(clean, { ...batch, failed: 0 })).toBe('3 upgraded')
      // An older failure from a previous batch does not count.
      const stale = report({
        upgrade: miseOk,
        recent: [{ ...brewFail, startedAt: T - 50, finishedAt: T - 40 }, masOk],
        batch,
      })
      expect(batchFailures(stale)).toEqual([])
    })
  })

  describe('upgrade run', () => {
    it('knows when a run is in flight', () => {
      expect(upgradeRunning(null)).toBe(false)
      expect(upgradeRunning(report())).toBe(false)
      expect(upgradeRunning(report({ upgrade: run() }))).toBe(true)
      expect(
        upgradeRunning(report({ upgrade: run({ finishedAt: T + 10 }) })),
      ).toBe(false)
    })

    it('names the target by package, source label, or "everything"', () => {
      expect(upgradeTarget(report(), run())).toBe('Homebrew')
      expect(upgradeTarget(report(), run({ item: 'gcc' }))).toBe('gcc')
      expect(upgradeTarget(report(), run({ source: 'all' }))).toBe('everything')
    })

    it('formats durations tersely', () => {
      expect(duration(3)).toBe('3s')
      expect(duration(72)).toBe('1 min 12s')
      expect(duration(7500)).toBe('2 h 5 min')
      expect(duration(-4)).toBe('0s')
    })

    it('headlines running, succeeded, failed, killed and cancelled runs', () => {
      const r = report()
      expect(upgradeLine(r, run(), T + 12)).toBe('upgrading Homebrew · 12s')
      expect(upgradeLine(r, run({ item: 'gcc' }), T + 12)).toBe(
        'upgrading gcc · 12s',
      )
      expect(upgradeLine(r, run({ finishedAt: T + 63, exitCode: 0 }), 0)).toBe(
        'Homebrew upgraded · 1 min 3s',
      )
      expect(upgradeLine(r, run({ finishedAt: T + 1, exitCode: 1 }), 0)).toBe(
        'Homebrew upgrade failed · exit 1',
      )
      expect(upgradeLine(r, run({ finishedAt: T + 1 }), 0)).toBe(
        'Homebrew upgrade failed · killed',
      )
      expect(
        upgradeLine(r, run({ finishedAt: T + 1, cancelled: true }), 0),
      ).toBe('Homebrew upgrade cancelled')
    })

    it('flags failures but not cancels or running', () => {
      expect(upgradeFailed(run())).toBe(false)
      expect(upgradeFailed(run({ finishedAt: 1, exitCode: 0 }))).toBe(false)
      expect(upgradeFailed(run({ finishedAt: 1, exitCode: 2 }))).toBe(true)
      expect(upgradeFailed(run({ finishedAt: 1, cancelled: true }))).toBe(false)
    })
  })

  describe('dismissed packages', () => {
    it('are counted apart and listed by name', () => {
      expect(totalDismissed(report())).toBe(0)
      const r = report({ sources: [brewWithDismissed, cleanSource] })
      expect(totalUpdates(r)).toBe(2)
      expect(totalDismissed(r)).toBe(1)
      expect(dismissedItems(brewWithDismissed).map((i) => i.name)).toEqual([
        'beeper/tap/cli',
      ])
      expect(dismissedItems(cleanSource)).toEqual([])
    })

    it('close their group as dim rows, even under a clean band', () => {
      const rows = ledgerRows(report({ sources: [brewWithDismissed] }))
      expect(rows.map((r) => r.kind)).toEqual([
        'band',
        'item',
        'item',
        'dismissed',
      ])
      const last = rows.at(-1)!
      expect(rowSelectable(last)).toBe(true)
      expect(rowCommand(last)).toBe('brew upgrade beeper/tap/cli')
      expect(rowUpgradeMessage(last)).toEqual({
        restore: 'brew',
        item: 'beeper/tap/cli',
      })
      const allAside = ledgerRows(
        report({
          sources: [{ ...brewWithDismissed, items: [], upgradeCommand: '' }],
        }),
      )
      expect(allAside.map((r) => r.kind)).toEqual(['clean', 'dismissed'])
    })

    it('d puts a pending package aside for a day and brings a dismissed one back', () => {
      const [band, gcc, , aside] = ledgerRows(
        report({ sources: [brewWithDismissed] }),
      )
      expect(rowDismissMessage(gcc!)).toEqual({
        dismiss: 'brew',
        item: 'gcc',
        hours: 24,
      })
      expect(rowDismissMessage(aside!)).toEqual({
        restore: 'brew',
        item: 'beeper/tap/cli',
      })
      expect(rowDismissMessage(band!)).toBeNull()
    })

    it('show in the headline and read how long they have left', () => {
      expect(headline(report({ sources: [brewWithDismissed] }))).toBe(
        '2 updates · 1 manager · 1 dismissed',
      )
      expect(
        headline(report({ sources: [{ ...brewWithDismissed, items: [] }] })),
      ).toBe('up to date · 1 dismissed')
      expect(dismissedLeft(T + 23 * 3600, T)).toBe('23 h left')
      expect(dismissedLeft(T + 90 * 60, T)).toBe('2 h left')
      expect(dismissedLeft(T + 40 * 60, T)).toBe('40 min left')
      expect(dismissedLeft(T + 30, T)).toBe('lapsing')
      expect(dismissedLeft(T - 5, T)).toBe('lapsing')
    })

    it('leave the cell and card counts alone when a source is all dismissed', () => {
      const r = report({
        sources: [{ ...brewWithDismissed, items: [], upgradeCommand: '' }],
      })
      expect(cellVisible(r)).toBe(false)
      expect(sourceHeadline(r, r.sources[0]!)).toEqual({
        text: 'up to date',
        status: 'clean',
      })
    })
  })
})
