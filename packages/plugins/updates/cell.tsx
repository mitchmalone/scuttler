import {
  BarCard,
  BarCell,
  BarHoverCell,
  ICON_PROPS,
  toneClass,
} from '@scuttlarr/tui'
import type { PluginCellProps } from '@scuttlarr/tui/plugins'
import { Package } from 'lucide-react'

import {
  STATUS_LABEL,
  type UpdateSource,
  type UpdatesReport,
  batchLine,
  batchProgress,
  cappedItems,
  cellTone,
  cellVisible,
  checkedAgo,
  countLine,
  dismissedItems,
  sourceHeadline,
  totalUpdates,
  upgradeLine,
  upgradeRunning,
  upgradeStatus,
} from './model'

/** Packages listed per source in the card before "+N more". */
const CARD_ITEMS = 6

/** Opening guess for the window growth; `cardRef` corrects it once drawn.
 * Head + foot, a block per source, a line per listed package. */
function cardHeight(report: UpdatesReport): number {
  let h = 130
  for (const s of report.sources) {
    const { shown, more } = cappedItems(s, CARD_ITEMS)
    h += 36 + shown.length * 20 + (more > 0 ? 20 : 0) + (s.error ? 20 : 0)
    if (s.dismissed?.length) h += 20
  }
  if (report.upgrade) h += 44
  return h
}

/** One source: its name and headline, then its packages with their versions
 * — or their runner status while the batch touches them. */
function CardSource({
  report,
  source,
}: {
  report: UpdatesReport
  source: UpdateSource
}) {
  const head = sourceHeadline(report, source)
  const { shown, more } = cappedItems(source, CARD_ITEMS)
  const aside = dismissedItems(source)
  const dismissed = aside.length
  const names = aside.map((i) => i.name).join(', ')
  return (
    <div
      className={`bar-updates-source ${
        head.status === 'clean' ? 'bar-updates-clean' : ''
      }`}
    >
      <div className="bar-updates-head">
        <span className="bar-updates-name">{source.label}</span>
        {head.status === 'pending' ? (
          <span className="bar-updates-chip">{head.text}</span>
        ) : (
          <span
            className={`bar-updates-headline bar-updates-${head.status}`}
            style={{ marginLeft: 0 }}
          >
            {head.text}
          </span>
        )}
      </div>
      {source.error != null && (
        <div className="bar-updates-note">{source.error}</div>
      )}
      {shown.map((item) => {
        const status = upgradeStatus(report, source.id, item.name)
        return (
          <div key={item.name} className="bar-updates-row">
            <span className="bar-updates-row-name">{item.name}</span>
            {status === 'idle' ? (
              <span className="bar-updates-row-versions">
                <span className="bar-updates-from">{item.installed}</span>
                <span className="bar-updates-arrow">→</span>
                <span className="bar-updates-to">{item.available}</span>
              </span>
            ) : (
              <span className={`bar-updates-row-status bar-updates-${status}`}>
                {STATUS_LABEL[status]}
              </span>
            )}
          </div>
        )
      })}
      {more > 0 && <div className="bar-updates-note">+{more} more</div>}
      {dismissed > 0 && (
        <div className="bar-updates-note">
          {dismissed} dismissed · {names}
        </div>
      )}
    </div>
  )
}

/**
 * The updates cell: the Linux `apt`-indicator convention — hidden while
 * every present source is clean and healthy, otherwise the package glyph
 * and a total count, `warn` toned when a source errored. Hover opens a card
 * shaped like the usage card: glyph, title and status line, a badge for the
 * state, a ruled block per source listing its packages (dismissed ones as a
 * one-line note), the live run's last line while one goes. Click opens
 * `updates ⏎`, where the upgrades are.
 */
export default function UpdatesCell({
  plugin,
  state,
  now,
  hover,
  host,
}: PluginCellProps<UpdatesReport>) {
  if (!cellVisible(state)) return null
  const report = state as UpdatesReport
  const total = totalUpdates(report)
  const nowSecs = Math.floor(now.getTime() / 1000)
  const running = upgradeRunning(report)
  const batch = batchProgress(report)
  const title =
    running && report.upgrade
      ? upgradeLine(report, report.upgrade, nowSecs)
      : countLine(total)
  const className = toneClass(cellTone(report))
  const body = (
    <>
      <Package {...ICON_PROPS} />
      {total}
    </>
  )
  if (!hover) {
    return (
      <BarCell className={className} title={title}>
        {body}
      </BarCell>
    )
  }
  const badge = running
    ? {
        text: batch && batch.total > 1 ? batchLine(batch) : 'upgrading',
        cls: 'running',
      }
    : report.sources.some((s) => s.error != null)
      ? { text: 'check failed', cls: 'error' }
      : total > 0
        ? { text: `${total} pending`, cls: 'pending' }
        : { text: 'up to date', cls: 'clean' }
  return (
    <BarHoverCell
      id={`plugin:${plugin.id}`}
      cardHeight={cardHeight(report)}
      hover={hover}
      className={className}
      wrapperClassName="bar-updates"
      onClick={() => host.openPanel()}
      card={
        <BarCard variant="updates" cardRef={hover.cardRef}>
          <div className="bar-updates-top">
            <span className="bar-updates-glyph">
              <Package size={30} strokeWidth={1.6} aria-hidden />
            </span>
            <div>
              <div className="bar-updates-title">Updates</div>
              <div className="bar-updates-sub">
                {countLine(total)} · {checkedAgo(report.generatedAt, nowSecs)}
              </div>
            </div>
            <span className={`bar-updates-badge bar-updates-${badge.cls}`}>
              {badge.text}
            </span>
          </div>
          {report.upgrade && (
            <div className="bar-updates-run">
              <div
                className={`bar-updates-run-line ${
                  running ? 'bar-updates-running' : ''
                }`}
              >
                {upgradeLine(report, report.upgrade, nowSecs)}
              </div>
              {running && (
                <div className="bar-updates-note">
                  {report.upgrade.tail.at(-1) ?? '…'}
                </div>
              )}
            </div>
          )}
          {report.sources.map((source) => (
            <CardSource key={source.id} report={report} source={source} />
          ))}
          <div className="bar-updates-foot">click for updates ⏎</div>
        </BarCard>
      }
    >
      {body}
    </BarHoverCell>
  )
}
