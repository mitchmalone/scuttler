import type { CellTone } from '@scuttler/tui'

/**
 * The updates plugin's logic, pure and tested apart from React — the
 * `Model.js` convention `calendar` established, kept here for the same
 * reason: the cell and panel stay presentational and this is what the tests
 * pin. Mirrors `updates.rs`'s `UpdatesReport`; keep the pair adjacent in
 * naming.
 */

export interface UpdatesReport {
  /** Epoch secs of the last completed refresh; 0 = never. */
  generatedAt: number
  /** A refresh is in flight (the cell can show it). */
  refreshing: boolean
  /** Only present sources, in the table order (docs/plans). */
  sources: UpdateSource[]
  /** The run in flight, or the last one finished; absent until the first. */
  upgrade?: UpgradeRun | null
  /** Jobs waiting behind `upgrade`, in the order they will run. */
  queue?: UpgradeJob[]
  /** Runs finished this session, oldest first (bounded in Rust). */
  recent?: UpgradeRun[]
  /** Jobs enqueued since the runner was last idle, and how many finished. */
  batch?: UpgradeBatch
  /** The system approval sheet for root jobs (localauth.rs): present while it
   * is up, and after a refusal until the next click. Absent before 2026-11-06. */
  approval?: Approval | null
}

/** Mirrors `updates.rs`'s `Approval`. */
export interface Approval {
  state: 'pending' | 'declined'
  /** Source ids the sheet covers. */
  sources: SourceId[]
  /** Why, when declined; '' while pending. */
  detail: string
  /** Epoch secs the sheet went up, or the refusal came back. */
  at: number
}

/** Mirrors `updates.rs`'s `AdminAccess`: root sources only (mas). `ready`,
 * the sudoers rule names the binary and the panel runs it after the approval
 * sheet; `needsRule`, `scuttler sudoers on` has not run with mas present. */
export type AdminAccess = 'ready' | 'needsRule'

/** Mirrors `updates.rs`'s `UpgradeBatch`. */
export interface UpgradeBatch {
  done: number
  total: number
  /** Of `done`, how many exited non-zero (a cancel is not a failure). */
  failed?: number
  /** Unix seconds the batch began. */
  startedAt?: number
}

/** Mirrors `updates.rs`'s `UpgradeJob`: a source, or one package of it. */
export interface UpgradeJob {
  source: SourceId
  item: string | null
  command: string
}

/** Mirrors `updates.rs`'s `UpgradeRun`. */
export interface UpgradeRun {
  /** Source id (`all` only in reports older than 2026-10-31). */
  source: SourceId | 'all'
  /** The package, when the job was one package rather than the source. */
  item?: string | null
  command: string
  startedAt: number
  /** 0 while running. */
  finishedAt: number
  /** null while running or when killed. */
  exitCode: number | null
  cancelled: boolean
  /** Last lines of stdout+stderr, oldest first. */
  tail: string[]
}

/** `scuttler` is the app itself (selfupdate.rs): its upgrade runs in-process, then relaunches. */
export type SourceId = 'scuttler' | 'brew' | 'mas' | 'pnpm' | 'mise'

export interface UpdateSource {
  id: SourceId
  label: string
  upgradeCommand: string
  /** Epoch secs; 0 if the first check hasn't finished. */
  checkedAt: number
  /** Last line of stderr / "timed out after 60s"; null when healthy. */
  error: string | null
  /** Outdated and pending; [] when up to date. */
  items: UpdateItem[]
  /** Outdated packages the user put aside (`d`): out of the count until
   * `dismissedUntil` or a newer version. Absent in reports before 2026-11-01. */
  dismissed?: UpdateItem[]
  /** Root sources only; absent on sources that run as the user. */
  admin?: AdminAccess
}

export interface UpdateItem {
  name: string
  installed: string
  available: string
  kind?: 'formula' | 'cask' | 'app'
  /** The command that upgrades this one package — what a click on its row runs. */
  upgradeCommand: string
  /** Epoch secs the dismissal lapses; 0 or absent on a pending package. */
  dismissedUntil?: number
}

/** How long `d` puts a package aside. */
export const DISMISS_HOURS = 24

/** The one-time setup a root source needs: the terminal command that
 * installs the sudoers rule (one admin password). */
export const SUDOERS_COMMAND = 'scuttler sudoers on'

/** A root source the rule does not cover yet: its rows run nothing from the
 * panel and say what to run once. */
export const needsRule = (source: UpdateSource): boolean =>
  source.admin === 'needsRule'

/** How long a refusal's line stays after the sheet came back (Rust also
 * clears it on the next click). */
export const DECLINED_SHOWN_SECS = 60

/**
 * The approval block's line: what the sheet is waiting for while it is up,
 * or why the root jobs did not run; null when there is nothing to say.
 */
export function approvalLine(
  report: UpdatesReport,
  nowSecs: number,
): { text: string; state: 'pending' | 'declined' } | null {
  const a = report.approval
  if (!a) return null
  const labels = a.sources
    .map((id) => report.sources.find((s) => s.id === id)?.label ?? id)
    .join(', ')
  if (a.state === 'pending') {
    return {
      text: `${labels}: approve with Touch ID, Apple Watch or your password`,
      state: 'pending',
    }
  }
  if (nowSecs - a.at > DECLINED_SHOWN_SECS) return null
  return { text: `${labels} skipped · ${a.detail}`, state: 'declined' }
}

/** The `host.send` messages the panel speaks (`plugins.rs::native_send`). */
export type UpdatesMessage =
  | { upgrade: string; item?: string }
  | { dismiss: SourceId; item: string; hours: number }
  | { restore: SourceId; item: string }

/** A source's dismissed packages, by name. */
export function dismissedItems(source: UpdateSource): UpdateItem[] {
  return [...(source.dismissed ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

/** Dismissed packages across every source. */
export function totalDismissed(report: UpdatesReport): number {
  return report.sources.reduce((n, s) => n + (s.dismissed?.length ?? 0), 0)
}

/** "23 h left" / "40 min left" / "lapsing" — a dismissal's remaining time. */
export function dismissedLeft(until: number, nowSecs: number): string {
  const left = until - nowSecs
  if (left < 60) return 'lapsing'
  if (left < 3600) return `${Math.floor(left / 60)} min left`
  return `${Math.round(left / 3600)} h left`
}

/** The `upgrade` message that means every present package manager. */
export const UPDATES_ALL = 'all'

/** The number of pending updates across every present source. */
export function totalUpdates(report: UpdatesReport): number {
  return report.sources.reduce((sum, s) => sum + s.items.length, 0)
}

/** Whether any source's last check failed. */
export function hasErrors(report: UpdatesReport): boolean {
  return report.sources.some((s) => s.error != null)
}

/**
 * The bar convention (Linux's `apt` indicator): a quiet strip. Hidden while
 * there's no report yet, no refresh has ever completed, or every present
 * source is clean and healthy — unless an upgrade is running, which the cell
 * should keep showing until the re-check lands.
 */
export function cellVisible(report: UpdatesReport | null): boolean {
  if (!report) return false
  if (report.generatedAt === 0) return false
  if (upgradeRunning(report)) return true
  return report.sources.some((s) => s.items.length > 0 || s.error != null)
}

/** `warn` when any source errored; `normal` otherwise. */
export function cellTone(report: UpdatesReport): CellTone {
  return hasErrors(report) ? 'warn' : 'normal'
}

/** "Homebrew · 3" / "App Store · up to date" / "mise · error: …". */
export function sourceLine(source: UpdateSource): string {
  if (source.error != null) return `${source.label} · error: ${source.error}`
  if (source.items.length === 0) return `${source.label} · up to date`
  return `${source.label} · ${source.items.length}`
}

/** "3 updates" / "1 update" / "up to date". */
export function countLine(total: number): string {
  if (total === 0) return 'up to date'
  return `${total} update${total === 1 ? '' : 's'}`
}

/** Whether a panel-owned upgrade is in flight. */
export function upgradeRunning(report: UpdatesReport | null): boolean {
  return report?.upgrade != null && report.upgrade.finishedAt === 0
}

/** Whether anything is running or waiting to run. */
export function upgradeBusy(report: UpdatesReport | null): boolean {
  return upgradeRunning(report) || (report?.queue?.length ?? 0) > 0
}

/** The label of what a run is upgrading: the package, a source's label, or
 * "everything". */
export function upgradeTarget(report: UpdatesReport, run: UpgradeRun): string {
  if (run.item) return run.item
  if (run.source === 'all') return 'everything'
  return report.sources.find((s) => s.id === run.source)?.label ?? run.source
}

/** "3s" / "1 min 12s" / "2 h 5 min" — a duration in seconds, terse. */
export function duration(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60}s`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

/**
 * The run's headline: "upgrading Homebrew · 12s" while running, then
 * "Homebrew upgraded · 1 min 3s" / "Homebrew upgrade failed · exit 1" /
 * "Homebrew upgrade cancelled".
 */
export function upgradeLine(
  report: UpdatesReport,
  run: UpgradeRun,
  nowSecs: number,
): string {
  const target = upgradeTarget(report, run)
  if (run.finishedAt === 0) {
    return `upgrading ${target} · ${duration(nowSecs - run.startedAt)}`
  }
  if (run.cancelled) return `${target} upgrade cancelled`
  const took = duration(run.finishedAt - run.startedAt)
  if (run.exitCode === 0) return `${target} upgraded · ${took}`
  const exit = run.exitCode == null ? 'killed' : `exit ${run.exitCode}`
  return `${target} upgrade failed · ${exit}`
}

/** Whether a finished run ended badly — the panel points at `t` (terminal) then. */
export function upgradeFailed(run: UpgradeRun): boolean {
  return run.finishedAt !== 0 && !run.cancelled && run.exitCode !== 0
}

/** The batch's progress, or null when nothing was ever queued. */
export function batchProgress(report: UpdatesReport): UpgradeBatch | null {
  const b = report.batch
  if (!b || b.total === 0) return null
  return b
}

/** "2 of 5", "3 of 3 · 1 failed" — the meter's right-hand count. */
export function batchLine(batch: UpgradeBatch): string {
  const base = `${Math.min(batch.done, batch.total)} of ${batch.total}`
  return batch.failed ? `${base} · ${batch.failed} failed` : base
}

/** The run block's headline once a batch of several jobs has finished:
 * "3 upgraded" / "2 upgraded · Homebrew failed" / "everything failed". */
export function batchHeadline(
  report: UpdatesReport,
  batch: UpgradeBatch,
): string {
  const failures = batchFailures(report)
  const ok = batch.done - failures.length
  if (failures.length === 0) return `${ok} upgraded`
  const who = failures.map((r) => upgradeTarget(report, r)).join(', ')
  if (ok === 0) return `${who} failed`
  return `${ok} upgraded · ${who} failed`
}

/** "checked just now" / "checked 12 min ago" / "checked 3 h ago" / "never checked". */
export function checkedAgo(generatedAt: number, nowSecs: number): string {
  if (generatedAt === 0) return 'never checked'
  const diff = Math.max(0, nowSecs - generatedAt)
  if (diff < 60) return 'checked just now'
  if (diff < 3600) return `checked ${Math.floor(diff / 60)} min ago`
  return `checked ${Math.floor(diff / 3600)} h ago`
}

/**
 * What the runner is doing to one package, or to a whole source (`item`
 * null): `running` while its job (or its source's job) is the current run,
 * `queued` while one waits, `failed` from the most recent finished run that
 * covered it and exited non-zero (it stays: the package is still listed
 * because the upgrade did not take), `done` from one that succeeded and that
 * the source has not been re-checked since — once the check lands the row
 * vanishes. `idle` otherwise.
 */
export type UpgradeStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed'

const covers = (
  run: { source: string; item?: string | null },
  sourceId: SourceId,
  item: string | null,
) =>
  run.source === sourceId &&
  (run.item == null || item == null || run.item === item)

export function upgradeStatus(
  report: UpdatesReport,
  sourceId: SourceId,
  item: string | null = null,
): UpgradeStatus {
  const run = report.upgrade
  if (run && run.finishedAt === 0 && covers(run, sourceId, item)) {
    return 'running'
  }
  if (report.queue?.some((j) => covers(j, sourceId, item))) return 'queued'
  const checkedAt =
    report.sources.find((s) => s.id === sourceId)?.checkedAt ?? 0
  const finished = [...(report.recent ?? []), ...(run ? [run] : [])]
    .filter((r) => r.finishedAt !== 0 && covers(r, sourceId, item))
    .sort((a, b) => b.finishedAt - a.finishedAt)[0]
  if (!finished || finished.cancelled) return 'idle'
  if (finished.exitCode !== 0) return 'failed'
  return finished.finishedAt < checkedAt ? 'idle' : 'done'
}

/** The failed run behind a `failed` status, for its error line. */
export function failedRun(
  report: UpdatesReport,
  sourceId: SourceId,
  item: string | null = null,
): UpgradeRun | null {
  const run = report.upgrade
  const finished = [...(report.recent ?? []), ...(run ? [run] : [])]
    .filter((r) => r.finishedAt !== 0 && covers(r, sourceId, item))
    .sort((a, b) => b.finishedAt - a.finishedAt)[0]
  if (!finished || finished.cancelled || finished.exitCode === 0) return null
  return finished
}

/** A run's last output line — brew's `Error: …`, or nothing. */
export const lastLine = (run: UpgradeRun): string => run.tail.at(-1) ?? ''

/** The failed runs of the current batch, oldest first. */
export function batchFailures(report: UpdatesReport): UpgradeRun[] {
  const since = report.batch?.startedAt ?? 0
  const run = report.upgrade
  return [...(report.recent ?? []), ...(run ? [run] : [])]
    .filter(
      (r) =>
        r.finishedAt !== 0 &&
        r.startedAt >= since &&
        !r.cancelled &&
        r.exitCode !== 0,
    )
    .sort((a, b) => a.finishedAt - b.finishedAt)
}

/** The word a row wears for its status; '' when idle (the versions show). */
export const STATUS_LABEL: Record<UpgradeStatus, string> = {
  idle: '',
  queued: 'queued',
  running: 'upgrading…',
  done: 'upgraded',
  failed: 'failed',
}

/** A source's headline for a tile or a card block: its status while the
 * runner touches it, else its count, "up to date" or "check failed". */
export function sourceHeadline(
  report: UpdatesReport,
  source: UpdateSource,
): { text: string; status: UpgradeStatus | 'error' | 'clean' | 'pending' } {
  const status = upgradeStatus(report, source.id)
  if (status !== 'idle') return { text: STATUS_LABEL[status], status }
  if (source.error != null) return { text: 'check failed', status: 'error' }
  if (source.items.length === 0) return { text: 'up to date', status: 'clean' }
  return { text: String(source.items.length), status: 'pending' }
}

/** Items by name, the order every surface lists them in. */
export function sortedItems(source: UpdateSource): UpdateItem[] {
  return [...source.items].sort((a, b) => a.name.localeCompare(b.name))
}

/** The first `max` items of a source and how many were left off — the hover
 * card's per-source block. */
export function cappedItems(
  source: UpdateSource,
  max: number,
): { shown: UpdateItem[]; more: number } {
  const items = sortedItems(source)
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) }
}

/** Packages shown per group before the "+N more" row, until expanded. */
export const GROUP_CAP = 8

/** A row in the panel's ledger: one list, every source in table order. */
export type PanelRow =
  | {
      /** A source's band: name, count, command, its own upgrade-all. Not
       * selectable; `u` on any row below it, or its button, upgrades it. */
      kind: 'band'
      source: UpdateSource
    }
  | {
      kind: 'item'
      source: UpdateSource
      item: UpdateItem
    }
  | {
      /** "+N more": ↵ expands the group. */
      kind: 'more'
      source: UpdateSource
      hidden: number
    }
  | { kind: 'clean'; source: UpdateSource }
  | { kind: 'error'; source: UpdateSource; error: string }
  | {
      /** A package put aside: dim, under its group; ↵ brings it back. */
      kind: 'dismissed'
      source: UpdateSource
      item: UpdateItem
    }

export const rowSelectable = (row: PanelRow) =>
  row.kind === 'item' ||
  row.kind === 'more' ||
  row.kind === 'error' ||
  row.kind === 'dismissed'

/**
 * The ledger: a band per source, then its packages (sorted by name, capped
 * at `GROUP_CAP` unless the source is in `expanded`), or one dim "up to
 * date" band for a clean source, or the band plus an error row for a source
 * whose check failed. A source's dismissed packages close its group as dim
 * rows, whatever else it shows.
 */
export function ledgerRows(
  report: UpdatesReport,
  expanded: ReadonlySet<string> = new Set(),
): PanelRow[] {
  const rows: PanelRow[] = []
  for (const source of report.sources) {
    if (source.error != null) {
      rows.push({ kind: 'band', source })
      rows.push({ kind: 'error', source, error: source.error })
    } else if (source.items.length === 0) {
      rows.push({ kind: 'clean', source })
    } else {
      rows.push({ kind: 'band', source })
      const items = sortedItems(source)
      const shown = expanded.has(source.id) ? items : items.slice(0, GROUP_CAP)
      for (const item of shown) rows.push({ kind: 'item', source, item })
      if (shown.length < items.length) {
        rows.push({
          kind: 'more',
          source,
          hidden: items.length - shown.length,
        })
      }
    }
    for (const item of dismissedItems(source)) {
      rows.push({ kind: 'dismissed', source, item })
    }
  }
  return rows
}

/** The command a row would run — what `c` copies and `t` hands to the
 * terminal. For a root source still without its rule, `c` copies the setup
 * command instead: that is the one thing to run. */
export function rowCommand(row: PanelRow): string {
  if (needsRule(row.source) && row.kind !== 'dismissed') return SUDOERS_COMMAND
  return row.kind === 'item' || row.kind === 'dismissed'
    ? row.item.upgradeCommand
    : row.source.upgradeCommand
}

/** The `host.send` message a row's ↵ sends — an upgrade, or for a dismissed
 * row its return — or null for a row that opens rather than runs ("+N
 * more", a clean band). */
export function rowUpgradeMessage(row: PanelRow): UpdatesMessage | null {
  switch (row.kind) {
    case 'item':
      // Nothing to run from the panel until the rule exists; the row says so.
      if (needsRule(row.source)) return null
      return { upgrade: row.source.id, item: row.item.name }
    case 'band':
    case 'error':
      if (needsRule(row.source)) return null
      return { upgrade: row.source.id }
    case 'dismissed':
      return { restore: row.source.id, item: row.item.name }
    default:
      return null
  }
}

/** The message `d` sends for a row: a pending package is put aside for
 * `DISMISS_HOURS`, a dismissed one brought back; null for the rest. */
export function rowDismissMessage(row: PanelRow): UpdatesMessage | null {
  switch (row.kind) {
    case 'item':
      return {
        dismiss: row.source.id,
        item: row.item.name,
        hours: DISMISS_HOURS,
      }
    case 'dismissed':
      return { restore: row.source.id, item: row.item.name }
    default:
      return null
  }
}

/** "5 updates · 3 managers" / "up to date · 1 dismissed" — the head's count
 * line; managers = sources with something pending. */
export function headline(report: UpdatesReport): string {
  const total = totalUpdates(report)
  const dismissed = totalDismissed(report)
  const aside = dismissed > 0 ? ` · ${dismissed} dismissed` : ''
  if (total === 0) return `up to date${aside}`
  const managers = report.sources.filter((s) => s.items.length > 0).length
  return `${countLine(total)} · ${managers} manager${managers === 1 ? '' : 's'}${aside}`
}
