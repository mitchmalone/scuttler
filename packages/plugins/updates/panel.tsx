import { KeyHints, ListRow, MeterRow, Panel, useListNav } from '@scuttler/tui'
import type { PluginPanelProps } from '@scuttler/tui/plugins'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Download,
  EyeOff,
  Loader,
  Package,
} from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import {
  type PanelRow,
  STATUS_LABEL,
  UPDATES_ALL,
  type UpdateSource,
  type UpdatesReport,
  type UpgradeStatus,
  batchFailures,
  batchHeadline,
  batchLine,
  batchProgress,
  checkedAgo,
  dismissedLeft,
  failedRun,
  headline,
  lastLine,
  ledgerRows,
  rowCommand,
  rowDismissMessage,
  rowSelectable,
  rowUpgradeMessage,
  totalUpdates,
  upgradeBusy,
  upgradeFailed,
  upgradeLine,
  upgradeRunning,
  upgradeStatus,
  upgradeTarget,
} from './model'

const ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

/** Unix seconds, ticking — "checked N ago" stays live while the panel is open. */
function useNowSecs(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** The glyph a row wears for its runner status; the download arrow otherwise. */
function StatusIcon({ status }: { status: UpgradeStatus }) {
  switch (status) {
    case 'running':
      return <Loader {...ICON} className="tui-updates-spin" />
    case 'queued':
      return <CircleDashed {...ICON} />
    case 'done':
      return <Check {...ICON} />
    case 'failed':
      return <AlertTriangle {...ICON} />
    default:
      return <Download {...ICON} />
  }
}

/** `installed → available`, or the status word while the runner has it —
 * with `action` (the failed row's "dismiss 24h") riding after it. */
function RowRight({
  status,
  installed,
  available,
  action,
}: {
  status: UpgradeStatus
  installed: string
  available: string
  action?: ReactNode
}) {
  if (status !== 'idle') {
    return (
      <span className="tui-updates-right">
        <span className={`tui-updates-status tui-updates-${status}`}>
          {STATUS_LABEL[status]}
        </span>
        {action}
      </span>
    )
  }
  return (
    <span className="tui-updates-versions">
      <span className="tui-updates-from">{installed}</span>
      <span className="tui-updates-arrow">→</span>
      <span className="tui-updates-to">{available}</span>
    </span>
  )
}

/** A bordered action with its key hint riding inside. */
function Button({
  primary = false,
  disabled = false,
  keyHint,
  onClick,
  children,
}: {
  primary?: boolean
  disabled?: boolean
  keyHint?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tui-updates-btn ${primary ? 'tui-updates-btn-primary' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
      {keyHint && <span className="tui-updates-key">{keyHint}</span>}
    </button>
  )
}

/** A source's band: name, count chip (or its runner status), command, and
 * the group's own upgrade-all. */
function Band({
  report,
  source,
  onUpgrade,
}: {
  report: UpdatesReport
  source: UpdateSource
  onUpgrade: () => void
}) {
  const status = upgradeStatus(report, source.id)
  const clean = source.error == null && source.items.length === 0
  const chip =
    status !== 'idle' ? (
      <span className={`tui-updates-chip tui-updates-chip-${status}`}>
        {STATUS_LABEL[status]}
      </span>
    ) : source.error != null ? (
      <span className="tui-updates-chip tui-updates-chip-error">!</span>
    ) : (
      <span
        className={`tui-updates-chip ${clean ? 'tui-updates-chip-zero' : ''}`}
      >
        {source.items.length}
      </span>
    )
  return (
    <div
      className={`tui-updates-band ${clean ? 'tui-updates-band-clean' : ''}`}
    >
      <span className="tui-updates-band-name">{source.label}</span>
      {chip}
      <span className="tui-updates-band-cmd">
        {clean ? 'up to date' : source.upgradeCommand}
      </span>
      {!clean && (
        <Button
          keyHint="u"
          disabled={status === 'running' || status === 'queued'}
          onClick={onUpgrade}
        >
          {source.error != null ? 'retry' : 'upgrade all'}
        </Button>
      )}
    </div>
  )
}

/**
 * `updates ⏎`: the ledger. One list, a band per package manager with its
 * count, its command and its own "upgrade all"; its packages under a gutter
 * rule, each `↵` or a click away from upgrading — one package, queued one
 * after another. "Upgrade everything" sits in the head. Long groups cap at
 * `GROUP_CAP` rows with a "+N more" row that expands. The run block (one
 * meter line and the last output line) sits above the ledger while anything
 * runs or just finished; `x` cancels. `u` upgrades the group of the selected
 * row, `a` everything, `d` puts the selected package aside for a day (a
 * failed row offers it as a button) and brings a dismissed one back — those
 * close their group as dim rows, `↵` restores — `t` hands the selected row
 * to the terminal (a tty for sudo), `c` copies its command, `r` re-checks,
 * Esc closes.
 */
export default function UpdatesPanel({
  state,
  host,
  onClose,
}: PluginPanelProps<UpdatesReport>) {
  const nowSecs = useNowSecs()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // Hooks run unconditionally: `rows` is [] before the first report, so
  // `useListNav` below always sees a stable count for this render.
  const rows: PanelRow[] = state ? ledgerRows(state, expanded) : []
  const selectable = rows
    .map((row, i) => (rowSelectable(row) ? i : -1))
    .filter((i) => i >= 0)

  const activate = (row: PanelRow | undefined) => {
    if (!row) return
    if (row.kind === 'more') {
      setExpanded((prev) => new Set(prev).add(row.source.id))
      return
    }
    const message = rowUpgradeMessage(row)
    if (message) host.send(message)
  }

  const nav = useListNav(selectable.length, {
    onActivate: (i) => activate(rows[selectable[i] ?? -1]),
    onBack: onClose,
  })
  const selectedIndex = selectable[nav.index] ?? -1
  const selectedRow = rows[selectedIndex]

  if (!state) {
    return (
      <Panel
        autoFocus
        icon={<Package size={17} strokeWidth={2} aria-hidden />}
        title="Updates"
        subtitle="checking…"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        footer={<KeyHints hints={[{ keys: 'esc', label: 'back' }]} />}
      >
        <ListRow dim label="checking…" />
      </Panel>
    )
  }

  const total = totalUpdates(state)
  const running = upgradeRunning(state)
  const busy = upgradeBusy(state)
  const batch = batchProgress(state)
  const run = state.upgrade ?? null
  const failures = batchFailures(state)
  // Once the batch is over, the block speaks for the batch, not the last job.
  const batchOver = !busy && batch != null && batch.total > 1
  const failed = batchOver
    ? failures.length > 0
    : run != null && upgradeFailed(run)
  const runLabel =
    run == null
      ? ''
      : batchOver
        ? batchHeadline(state, batch)
        : upgradeLine(state, run, nowSecs)

  const upgradeGroup = (source: UpdateSource | undefined) => {
    if (source) host.send({ upgrade: source.id })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'r') {
      e.preventDefault()
      host.send({ refresh: true })
    } else if (e.key === 'c') {
      e.preventDefault()
      if (selectedRow) host.copy(rowCommand(selectedRow))
    } else if (e.key === 'a') {
      e.preventDefault()
      if (total > 0) host.send({ upgrade: UPDATES_ALL })
    } else if (e.key === 'u') {
      e.preventDefault()
      upgradeGroup(selectedRow?.source)
    } else if (e.key === 'd') {
      e.preventDefault()
      const message = selectedRow && rowDismissMessage(selectedRow)
      if (message) host.send(message)
    } else if (e.key === 't') {
      e.preventDefault()
      if (selectedRow) {
        host.send({
          upgradeInTerminal: selectedRow.source.id,
          ...(selectedRow.kind === 'item' || selectedRow.kind === 'dismissed'
            ? { item: selectedRow.item.name }
            : {}),
        })
        onClose()
      }
    } else if (e.key === 'x') {
      e.preventDefault()
      if (running) host.send({ cancelUpgrade: true })
    } else {
      nav.onKeyDown(e)
    }
  }

  const hints: { keys: ReactNode; label: ReactNode }[] = [
    { keys: '↵', label: busy ? 'queue' : 'upgrade' },
    { keys: 'u', label: 'group' },
    { keys: 'a', label: 'all' },
    {
      keys: 'd',
      label: selectedRow?.kind === 'dismissed' ? 'restore' : 'dismiss 24h',
    },
    ...(running ? [{ keys: 'x', label: 'cancel' }] : []),
    { keys: 't', label: 'terminal' },
    { keys: 'c', label: 'copy' },
    { keys: 'r', label: 'refresh' },
    { keys: 'esc', label: 'back' },
  ]

  const subtitle = `${headline(state)} · ${
    state.refreshing ? 'checking…' : checkedAgo(state.generatedAt, nowSecs)
  }`

  // Group the flat rows by source so each group gets its gutter.
  const groups: {
    source: UpdateSource
    rows: { row: PanelRow; i: number }[]
  }[] = []
  rows.forEach((row, i) => {
    const last = groups[groups.length - 1]
    if (last && last.source.id === row.source.id) last.rows.push({ row, i })
    else groups.push({ source: row.source, rows: [{ row, i }] })
  })

  // Meter: finished jobs over the batch, the live one counting as a half.
  const meterMax = batch ? batch.total : 1
  const meterValue = batch
    ? Math.min(batch.done + (running ? 0.5 : 0), batch.total)
    : running
      ? 0.5
      : 1
  const meterRight =
    batch && batch.total > 1
      ? `${batchLine(batch)}${
          state.queue && state.queue.length > 0
            ? ` · ${state.queue.length} queued`
            : ''
        }`
      : failed
        ? 't to retry in the terminal'
        : run?.command

  return (
    <Panel
      autoFocus
      icon={<Package size={17} strokeWidth={2} aria-hidden />}
      title="Updates"
      subtitle={subtitle}
      right={
        total > 0 ? (
          <Button
            primary
            keyHint="a"
            disabled={busy}
            onClick={() => host.send({ upgrade: UPDATES_ALL })}
          >
            upgrade everything
          </Button>
        ) : null
      }
      onKeyDown={onKeyDown}
      footer={<KeyHints hints={hints} />}
    >
      {run && (
        <div
          className={`tui-updates-run ${
            running
              ? ''
              : failed
                ? 'tui-updates-run-failed'
                : 'tui-updates-run-finished'
          }`}
        >
          <MeterRow
            label={runLabel}
            value={meterValue}
            max={meterMax}
            right={meterRight}
            tone={failed ? 'danger' : running ? null : 'good'}
          />
          {running && run.tail.length > 0 && (
            <div className="tui-updates-tail">{run.tail.at(-1)}</div>
          )}
          {!running &&
            failures.map((f) => (
              <div
                key={`${f.source}-${f.item ?? ''}-${f.finishedAt}`}
                className="tui-updates-tail tui-updates-error"
              >
                {upgradeTarget(state, f)}: {lastLine(f) || 'no output'}
              </div>
            ))}
        </div>
      )}
      {groups.map((group) => (
        <div key={group.source.id} className="tui-updates-group">
          {group.rows.map(({ row, i }) => {
            const selected = i === selectedIndex
            const hover = () => {
              const si = selectable.indexOf(i)
              if (si >= 0) nav.setIndex(si)
            }
            const click = () => {
              hover()
              activate(row)
            }
            switch (row.kind) {
              case 'band':
              case 'clean':
                return (
                  <Band
                    key={`band-${row.source.id}`}
                    report={state}
                    source={row.source}
                    onUpgrade={() => upgradeGroup(row.source)}
                  />
                )
              case 'item': {
                const status = upgradeStatus(
                  state,
                  row.source.id,
                  row.item.name,
                )
                const fail =
                  status === 'failed'
                    ? failedRun(state, row.source.id, row.item.name)
                    : null
                return (
                  <ListRow
                    key={`${row.source.id}-${row.item.name}`}
                    icon={<StatusIcon status={status} />}
                    label={row.item.name}
                    sub={
                      fail ? (
                        <span className="tui-updates-error">
                          {lastLine(fail) || 'failed'} · t to retry in the
                          terminal
                        </span>
                      ) : (
                        row.item.upgradeCommand
                      )
                    }
                    right={
                      <RowRight
                        status={status}
                        installed={row.item.installed}
                        available={row.item.available}
                        action={
                          fail ? (
                            <Button
                              keyHint="d"
                              onClick={() => {
                                const message = rowDismissMessage(row)
                                if (message) host.send(message)
                              }}
                            >
                              dismiss 24h
                            </Button>
                          ) : null
                        }
                      />
                    }
                    selected={selected}
                    onHover={hover}
                    onClick={click}
                  />
                )
              }
              case 'dismissed':
                return (
                  <ListRow
                    key={`dismissed-${row.source.id}-${row.item.name}`}
                    dim
                    icon={<EyeOff {...ICON} />}
                    label={row.item.name}
                    sub={`${row.item.installed} → ${row.item.available} · ${row.item.upgradeCommand}`}
                    right={
                      <span className="tui-updates-right">
                        <span className="tui-updates-status tui-updates-dismissed">
                          dismissed ·{' '}
                          {dismissedLeft(row.item.dismissedUntil ?? 0, nowSecs)}
                        </span>
                        <Button keyHint="↵" onClick={click}>
                          restore
                        </Button>
                      </span>
                    }
                    selected={selected}
                    onHover={hover}
                    onClick={click}
                  />
                )
              case 'more':
                return (
                  <ListRow
                    key={`more-${row.source.id}`}
                    dim
                    icon="…"
                    label={`+${row.hidden} more`}
                    right="↵ show all"
                    selected={selected}
                    onHover={hover}
                    onClick={click}
                  />
                )
              case 'error':
                return (
                  <ListRow
                    key={`error-${row.source.id}`}
                    icon={<AlertTriangle {...ICON} />}
                    label={
                      <span className="tui-updates-error">check failed</span>
                    }
                    sub={row.error}
                    right="↵ retry · r re-check"
                    selected={selected}
                    onHover={hover}
                    onClick={click}
                  />
                )
            }
          })}
        </div>
      ))}
    </Panel>
  )
}
