import type { PluginState } from '@scuttler/tui/plugins'

import manifest from './manifest.json'
import type { UpdatesReport } from './model'

/**
 * Fictional updates in the shape `updates.rs` emits — Homebrew (two
 * formulae and a cask), one App Store title, a clean pnpm, and mise's check
 * failing — with a batch under way: gcc upgrading, vips queued. The cell,
 * card, and panel are the real components; only these numbers are made up
 * (AGENTS invariant 10). Shared by the website's demo.
 */
export function updatesReportAt(nowSecs: number): UpdatesReport {
  return {
    generatedAt: nowSecs,
    refreshing: false,
    sources: [
      {
        id: 'brew',
        label: 'Homebrew',
        upgradeCommand: 'brew upgrade',
        checkedAt: nowSecs - 60,
        error: null,
        items: [
          {
            name: 'gcc',
            installed: '16.1.0',
            available: '16.2.0',
            kind: 'formula',
            upgradeCommand: 'brew upgrade gcc',
          },
          {
            name: 'vips',
            installed: '8.18.5_1',
            available: '8.18.6',
            kind: 'formula',
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
      },
      {
        id: 'mas',
        label: 'App Store',
        upgradeCommand: 'mas upgrade',
        checkedAt: nowSecs - 60,
        error: null,
        items: [
          {
            name: 'Xcode',
            installed: '26.0',
            available: '26.1',
            upgradeCommand: 'mas upgrade 497799835',
          },
        ],
      },
      {
        id: 'pnpm',
        label: 'pnpm',
        upgradeCommand: 'pnpm update -g',
        checkedAt: nowSecs - 60,
        error: null,
        items: [],
      },
      {
        id: 'mise',
        label: 'mise',
        upgradeCommand: 'mise upgrade',
        checkedAt: nowSecs - 60,
        error: 'registry timed out',
        items: [],
      },
    ],
    upgrade: {
      source: 'brew',
      item: 'gcc',
      command: 'brew upgrade gcc',
      startedAt: nowSecs - 8,
      finishedAt: 0,
      exitCode: null,
      cancelled: false,
      tail: [
        '==> Upgrading 1 outdated package:',
        'gcc 16.1.0 -> 16.2.0',
        '==> Fetching gcc',
        '==> Downloading https://ghcr.io/v2/homebrew/core/gcc/manifests/16.2.0',
      ],
    },
    queue: [{ source: 'brew', item: 'vips', command: 'brew upgrade vips' }],
    recent: [],
    batch: { done: 0, total: 2, failed: 0, startedAt: nowSecs - 9 },
  }
}

/** The same report with nothing running: the resting state. */
export function idleUpdatesReportAt(nowSecs: number): UpdatesReport {
  return {
    ...updatesReportAt(nowSecs),
    upgrade: null,
    queue: [],
    recent: [],
    batch: { done: 0, total: 0, failed: 0, startedAt: 0 },
  }
}

/** The report at a fixed instant — stories and tests want determinism. */
export const UPDATES_REPORT: UpdatesReport = updatesReportAt(1_800_000_000)

/** The updates plugin as plugins.rs would list it, carrying the fixture. */
export const UPDATES_PLUGIN: PluginState = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  kinds: manifest.kinds,
  zone: manifest.zone,
  icon: manifest.icon,
  firstParty: true,
  enabled: true,
  hasCell: true,
  hasPanel: true,
  hasService: false,
  interval: null,
  builtAt: null,
  buildError: null,
  state: UPDATES_REPORT,
  error: null,
  lastOk: UPDATES_REPORT.generatedAt,
  updatedAt: UPDATES_REPORT.generatedAt,
  restarts: 0,
  running: false,
  panel: manifest.panel,
}
