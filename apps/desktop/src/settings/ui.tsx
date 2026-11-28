import { invoke } from '@tauri-apps/api/core'
import type { LucideIcon } from 'lucide-react'
import { CornerDownLeft, FileCode } from 'lucide-react'
import type { ReactNode } from 'react'

import { rowAnchor } from './search'

/**
 * The one layout grammar every settings page uses (Claude Design 1a): a Page
 * header, Sections (uppercase label over a bordered box), and inside a box
 * either Rows (label + hint left, control right) or Blocks (full width, for
 * lists, boards and output). Booleans are Toggles.
 */

export function Page({
  icon: Icon,
  title,
  description,
  configKey,
  aside,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  configKey?: string | null
  /** Extra header content on the right (a rung pill). */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <article className="page">
      <header className="pagehead">
        <Icon size={20} strokeWidth={1.8} aria-hidden className="pageicon" />
        <h1>{title}</h1>
        <div className="pagehead-r">
          {aside}
          {configKey && (
            <span
              className="keychip"
              title="The config.json keys this page writes"
            >
              config.json › <b>{configKey}</b>
            </span>
          )}
          {configKey && (
            <button
              type="button"
              className="btn dim"
              title="Open config.json in your editor"
              onClick={() =>
                invoke('open_path', { target: 'config' }).catch(console.error)
              }
            >
              <FileCode size={12} strokeWidth={1.8} aria-hidden />
              edit
            </button>
          )}
        </div>
      </header>
      {description && <p className="pagedesc">{description}</p>}
      {children}
    </article>
  )
}

export function Section({
  title,
  aside,
  plain = false,
  children,
}: {
  title?: string
  aside?: ReactNode
  /** No bordered box: for content that brings its own frame. */
  plain?: boolean
  children: ReactNode
}) {
  return (
    <section className="sec">
      {(title || aside) && (
        <div className="sechead">
          {title && <span>{title}</span>}
          {aside && <span className="sechead-aside">{aside}</span>}
        </div>
      )}
      {plain ? children : <div className="box">{children}</div>}
    </section>
  )
}

/**
 * A label + hint on the left, the control on the right. `label` doubles as the
 * row's search anchor (pages.ts SEARCH_INDEX), so keep the two in step.
 * `below` is full-width content under the row that belongs to it.
 */
export function Row({
  label,
  hint,
  cfg,
  disabled = false,
  children,
  below,
}: {
  label: string
  hint?: ReactNode
  /** The key within the page's config object, shown faint after the label. */
  cfg?: string
  disabled?: boolean
  children?: ReactNode
  below?: ReactNode
}) {
  return (
    <div className={`rw${disabled ? ' dis' : ''}`} data-row={rowAnchor(label)}>
      <div className="rw-main">
        <div className="rw-l">
          <div className="rw-t">
            {label}
            {cfg && <span className="rw-k">{cfg}</span>}
          </div>
          {hint && <div className="rw-h">{hint}</div>}
        </div>
        {children !== undefined && <div className="rw-c">{children}</div>}
      </div>
      {below && <div className="rw-below">{below}</div>}
    </div>
  )
}

/** Full-width content inside a box; `anchor` makes it a search target. */
export function Block({
  anchor,
  children,
}: {
  anchor?: string
  children: ReactNode
}) {
  return (
    <div className="blk" data-row={anchor ? rowAnchor(anchor) : undefined}>
      {children}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  /** Accessible name; the row label usually provides the visible one. */
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`tg${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={o.id === value ? 'on' : ''}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A rung that is off (invariant 12: off means off) shows only what turning it
 * on will do — consequences first, then one labelled Enter row (invariant 13:
 * a question is a row, never a modal). `anchor` is the toggle's search label.
 */
export function RungOff({
  anchor,
  question,
  lines,
  action,
  onTurnOn,
  disabled = false,
  children,
}: {
  anchor: string
  /** Asked above the consequences, when the feature is a yes/no. */
  question?: string
  /** `+` lines change something; `·` lines reassure. */
  lines: readonly { mark: '+' | '·'; text: ReactNode }[]
  action: string
  onTurnOn: () => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div className="rungoff" data-row={rowAnchor(anchor)}>
      {question && <p className="rungoff-q">{question}</p>}
      <ul className="rungoff-lines">
        {lines.map((l, i) => (
          <li key={i} className={l.mark === '+' ? 'plus' : 'dot'}>
            <span className="mark">{l.mark}</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {children}
      <button
        type="button"
        className="enter"
        disabled={disabled}
        onClick={onTurnOn}
      >
        <CornerDownLeft size={14} strokeWidth={1.8} aria-hidden />
        <span className="enter-label">{action}</span>
        <kbd>↵</kbd>
      </button>
    </div>
  )
}

/** A short status line: muted, or in the danger/good tone. */
export function Note({
  tone,
  children,
}: {
  tone?: 'error' | 'good' | 'warn'
  children: ReactNode
}) {
  return <p className={`note${tone ? ` ${tone}` : ''}`}>{children}</p>
}
