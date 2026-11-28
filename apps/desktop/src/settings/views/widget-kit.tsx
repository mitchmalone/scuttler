import type { BarSnapshot, BarWidget, WidgetSetting } from '@scuttler/tui'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'

import type { Config } from '../../lib/config'
import type { SetFn } from '../types'
import { shownFields } from '../widget-fields'

/**
 * What plugins and widgets share (docs/WIDGETS.md, docs/PLUGINS.md): the live
 * widget list, the status line, declared settings (plain, secret, sign-in) and
 * prerequisites. A plugin declares settings the same way a widget does.
 */

/**
 * The live user widgets (docs/WIDGETS.md), polled from the bar snapshot while
 * the Bar or Widgets page is open — an in-memory read Rust-side, so 2 s is cheap, and
 * it lets the board and the widgets list follow adds/removes/ticks live.
 */
export function useWidgets(): BarWidget[] {
  const [widgets, setWidgets] = useState<BarWidget[]>([])
  useEffect(() => {
    let live = true
    const pull = () =>
      invoke<BarSnapshot>('bar_snapshot')
        .then((s) => live && setWidgets(s.widgets ?? []))
        .catch(console.error)
    pull()
    const t = window.setInterval(pull, 2000)
    return () => {
      live = false
      window.clearInterval(t)
    }
  }, [])
  return widgets
}

/** "ok · 3m ago" / "error · exit 1 …" / "hidden" / "waiting" for the list. */
export function widgetStatus(w: BarWidget, now: number): string {
  const ago = (t: number) => {
    const s = Math.max(0, Math.round(now / 1000 - t))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.round(s / 60)}m ago`
    return `${Math.round(s / 3600)}h ago`
  }
  if (w.needs?.length) return `needs setup · ${w.needs.join(', ')}`
  if (w.view?.setup) return `setup · ${w.view.setup.message}`
  if (w.error) {
    return `error · ${w.error}${w.lastOk ? ` · last ok ${ago(w.lastOk)}` : ''}`
  }
  if (!w.view) return 'waiting for the first tick'
  const at = w.updatedAt ? ` · ${ago(w.updatedAt)}` : ''
  return w.view.hidden ? `hidden${at}` : `ok${at}`
}

/** A widget that's running fine needs no fields under it — a healthy row is
 * just its name and "ok" (Mitch, 2026-08-20: a page of token inputs reads as
 * "asking for tokens" even when every one is optional). */
const widgetNeedsAttention = (w: BarWidget) =>
  Boolean(w.needs?.length || w.view?.setup || w.error)

/** One `widget-auth` event from widgets.rs (`AuthEvent`). */
type WidgetAuthEvent =
  | { phase: 'code'; id: string; url: string; code: string }
  | { phase: 'message'; id: string; message: string }
  | { phase: 'done'; id: string }
  | { phase: 'error'; id: string; error: string }

/**
 * A widget's declared settings (docs/WIDGETS.md): plain values bind to
 * `config.widgets[id]`; secrets go to the Keychain through `widget_secret_set`
 * and the UI only learns which are set. A widget with `auth` puts its sign-in
 * button on the row of its first secret — the user signs in *or* pastes a
 * token, one row either way (Mitch, 2026-08-19).
 */
export function WidgetSettings({
  widget,
  config,
  set,
}: {
  widget: BarWidget
  config: Config
  set: SetFn
}) {
  const settings = widget.settings ?? []
  const plain = config.widgets[widget.id] ?? {}
  const [present, setPresent] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [auth, setAuth] = useState<WidgetAuthEvent | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const hasSecrets = settings.some((s) => s.secret)
  const authKey = widget.auth ? settings.find((s) => s.secret)?.key : undefined

  const refreshPresent = useCallback(() => {
    if (!hasSecrets) return
    invoke<string[]>('widget_secret_keys', { id: widget.id })
      .then(setPresent)
      .catch(console.error)
  }, [widget.id, hasSecrets])
  useEffect(refreshPresent, [refreshPresent])

  useEffect(() => {
    if (!widget.auth) return
    const un = listen<WidgetAuthEvent>('widget-auth', (e) => {
      if (e.payload.id !== widget.id) return
      setAuth(e.payload)
      if (e.payload.phase === 'done') refreshPresent()
    })
    return () => {
      un.then((u) => u())
    }
  }, [widget.id, widget.auth, refreshPresent])

  const attention = widgetNeedsAttention(widget)
  const isSet = (s: WidgetSetting) =>
    s.secret ? present.includes(s.key) : Boolean(plain[s.key])
  // A field once shown stays while the page is open, so a save never hides its
  // siblings (rule: widget-fields.ts).
  const natural = shownFields(settings, {
    selfServe: (widget.requires?.length ?? 0) > 0,
    attention,
    isSet,
  })
  const naturalKey = natural.join('\n')
  const [kept, setKept] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    const keys = naturalKey ? naturalKey.split('\n') : []
    setKept((k) =>
      keys.every((key) => k.includes(key))
        ? k
        : [...k, ...keys.filter((key) => !k.includes(key))],
    )
  }, [naturalKey])
  if (!settings.length) return null
  const visible = (s: WidgetSetting) =>
    showAll || natural.includes(s.key) || kept.includes(s.key)
  const hidden = settings.filter((s) => !visible(s)).length

  const setPlain = (key: string, value: string) => {
    const mine = { ...plain }
    if (value) mine[key] = value
    else delete mine[key]
    const all = { ...config.widgets }
    if (Object.keys(mine).length) all[widget.id] = mine
    else delete all[widget.id]
    set('widgets', all)
  }
  const saveSecret = (key: string, value: string | null) => {
    setNote(null)
    invoke('widget_secret_set', { id: widget.id, key, value })
      .then(() => {
        setDrafts((d) => ({ ...d, [key]: '' }))
        setAuth(null)
        refreshPresent()
      })
      .catch((e) => setNote(String(e)))
  }
  const startAuth = () => {
    setNote(null)
    setAuth({ phase: 'message', id: widget.id, message: 'starting…' })
    invoke('widget_auth', { id: widget.id }).catch((e) => setNote(String(e)))
  }
  const cancelAuth = () => {
    invoke('widget_auth_cancel', { id: widget.id }).catch(console.error)
    setAuth(null)
  }
  const authBusy =
    auth != null && (auth.phase === 'code' || auth.phase === 'message')

  /** The sign-in controls, inline on the token row. */
  const authControls = () => {
    if (!widget.auth) return null
    if (auth?.phase === 'code') {
      return (
        <>
          <span className="widgetauth-text">
            enter <code className="widgetauth-code">{auth.code}</code> at
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              invoke('open_url', { url: auth.url }).catch(console.error)
            }
          >
            {auth.url.replace(/^https?:\/\//, '')}
          </button>
          <button type="button" className="btn" onClick={cancelAuth}>
            cancel
          </button>
        </>
      )
    }
    if (auth?.phase === 'message') {
      return (
        <>
          <span className="widgetauth-text">{auth.message}</span>
          <button type="button" className="btn" onClick={cancelAuth}>
            cancel
          </button>
        </>
      )
    }
    return (
      <button type="button" className="btn nowrap" onClick={startAuth}>
        {widget.auth.label}
      </button>
    )
  }

  const field = (s: WidgetSetting) => {
    const missing = widget.needs?.includes(s.key)
    if (!visible(s)) return null
    const req = (s.required || missing) && (
      <span className="widgetsetting-req"> · required</span>
    )
    if (!s.secret) {
      return (
        <div className="linkrow widgetsetting" key={s.key}>
          <label
            className="widgetsetting-label"
            htmlFor={`ws-${widget.id}-${s.key}`}
          >
            {s.label}
            {!plain[s.key] && req}
          </label>
          <input
            id={`ws-${widget.id}-${s.key}`}
            type="text"
            className="grow"
            placeholder={s.hint ?? s.key}
            value={plain[s.key] ?? ''}
            onChange={(e) => setPlain(s.key, e.target.value)}
          />
        </div>
      )
    }
    const withAuth = s.key === authKey
    if (isSet(s)) {
      // Set: say so, offer clear — no input until they want to replace it.
      return (
        <div className="linkrow widgetsetting" key={s.key}>
          <span className="widgetsetting-label">{s.label}</span>
          <span className="widgetsetting-set">
            {withAuth && auth?.phase === 'done' ? 'signed in' : 'set'}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => saveSecret(s.key, null)}
          >
            {withAuth ? 'sign out' : 'clear'}
          </button>
        </div>
      )
    }
    // Unset with a sign-in: the button leads; paste is the fallback. A failed
    // sign-in reports on its own line under the row — never inline, where a
    // long message crushes the field (Mitch, 2026-08-19).
    const busy = withAuth && authBusy
    const authError = withAuth && auth?.phase === 'error' ? auth.error : null
    return (
      <div key={s.key}>
        <div className="linkrow widgetsetting">
          <label
            className="widgetsetting-label"
            htmlFor={`ws-${widget.id}-${s.key}`}
          >
            {s.label}
            {req}
          </label>
          {withAuth && authControls()}
          {!busy && (
            <>
              {withAuth && <span className="widgetsetting-or">or paste</span>}
              <input
                id={`ws-${widget.id}-${s.key}`}
                type="password"
                className="grow"
                autoComplete="off"
                placeholder={s.hint ?? s.key}
                value={drafts[s.key] ?? ''}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [s.key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && drafts[s.key])
                    saveSecret(s.key, drafts[s.key]!)
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={!drafts[s.key]}
                onClick={() => saveSecret(s.key, drafts[s.key]!)}
              >
                save
              </button>
            </>
          )}
        </div>
        {authError && (
          <p className="note error widgetsetting-note">{authError}</p>
        )}
      </div>
    )
  }

  return (
    <div className="widgetsettings">
      {settings.map(field)}
      {hidden > 0 && (
        <button
          type="button"
          className="btn widgetsetting-more"
          onClick={() => setShowAll(true)}
        >
          show {hidden} more {hidden === 1 ? 'setting' : 'settings'}
        </button>
      )}
      {note && <p className="note error">{note}</p>}
    </div>
  )
}

/**
 * Declared prerequisites (manifest `requires`) + the live setup message when
 * the widget can't run: what it expects, and the copyable command that fixes
 * it. Rendered under the widget's row like its settings.
 */
export function WidgetPrereqs({ widget }: { widget: BarWidget }) {
  const requires = widget.requires ?? []
  const setup = widget.view?.setup
  const [copied, setCopied] = useState<string | null>(null)
  // A healthy widget explains nothing — prerequisites appear when unmet.
  if (!widgetNeedsAttention(widget)) return null
  if (!requires.length && !setup) return null
  const copy = (cmd: string) => {
    navigator.clipboard
      .writeText(cmd)
      .then(() => setCopied(cmd))
      .catch(console.error)
  }
  const fix = (cmd: string | null | undefined) =>
    cmd && (
      <button
        type="button"
        className="btn widgetfix"
        title="copy the command"
        onClick={() => copy(cmd)}
      >
        {copied === cmd ? 'copied' : cmd}
      </button>
    )
  return (
    <div className="widgetsettings widgetprereqs">
      {setup && (
        <div className="linkrow widgetsetting">
          <span className="widgetsetting-label widgetsetting-req">
            needs you
          </span>
          <span className="widgetprereq-text">{setup.message}</span>
          {fix(setup.fix)}
        </div>
      )}
      {requires.map((r) => (
        <div className="linkrow widgetsetting" key={r.label}>
          <span className="widgetsetting-label">expects</span>
          <span className="widgetprereq-text">{r.label}</span>
          {fix(r.fix)}
        </div>
      ))}
    </div>
  )
}
