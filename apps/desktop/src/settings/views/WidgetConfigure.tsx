import {
  type BarWidget,
  WidgetGlyph,
  type WidgetServiceType,
  type WidgetSetting,
} from '@scuttler/tui'
import { invoke } from '@tauri-apps/api/core'
import { ArrowLeft, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Config, WidgetService } from '../../lib/config'
import type { SetFn } from '../types'
import { Block, Section } from '../ui'
import {
  addService,
  serviceMissing,
  setServiceValue,
  updateService,
} from '../widget-services'
import { WidgetPrereqs, WidgetSettings, widgetStatus } from './widget-kit'

/**
 * Settings → Widgets → configure: one widget's own screen (Claude Design
 * `05 Widget services`, 5b; DECISIONS 2026-11-27). Its services, stacked and
 * collapsible, with Add service in the Services header; then its plain
 * settings and prerequisites. Every widget opens here, so the Widgets page
 * stays an inventory.
 */
export function WidgetConfigure({
  widget,
  config,
  set,
  onBack,
}: {
  widget: BarWidget
  config: Config
  set: SetFn
  onBack: () => void
}) {
  const types = widget.services ?? []
  const list = config.widgetServices?.[widget.id] ?? []
  // The one just added opens; others open themselves while incomplete.
  const [fresh, setFresh] = useState<string | null>(null)
  const settings = widget.settings ?? []
  const hasSettings = settings.length > 0 || (widget.requires?.length ?? 0) > 0

  const add = (type: WidgetServiceType) => {
    const { map, id } = addService(config.widgetServices, widget.id, type)
    set('widgetServices', map)
    setFresh(id)
  }

  return (
    <article className="page">
      <div className="crumb">
        <button type="button" className="btn sm" onClick={onBack}>
          <ArrowLeft size={12} strokeWidth={1.8} aria-hidden />
          Widgets
        </button>
        <span>Widgets › {widget.name}</span>
      </div>
      <header className="pagehead">
        <span className="pageicon" aria-hidden>
          <WidgetGlyph name={widget.icon} size={20} />
        </span>
        <h1>{widget.name}</h1>
        <div className="pagehead-r">
          <span
            className={`keychip${widget.error ? ' error' : ''}`}
            title={widget.error ?? undefined}
          >
            {widgetStatus(widget, Date.now())}
          </span>
        </div>
      </header>
      {types.length > 0 && (
        <p className="pagedesc">
          Each service gets its own header in the bar card. A service missing a
          required field is skipped: nothing is fetched for it until it&apos;s
          complete.
        </p>
      )}

      {types.length > 0 && (
        <Section
          title="Services"
          aside={
            <>
              {list.length}
              <AddServiceMenu types={types} onAdd={add} />
            </>
          }
        >
          {list.length === 0 && (
            <Block>
              <p className="blk-hint">
                No services yet. Add one above; nothing is fetched until you do.
              </p>
            </Block>
          )}
          {list.map((svc) => (
            <ServiceEntry
              key={svc.id}
              widget={widget}
              svc={svc}
              type={types.find((t) => t.type === svc.type)}
              startOpen={svc.id === fresh}
              config={config}
              set={set}
            />
          ))}
        </Section>
      )}

      {hasSettings && (
        <Section title="Settings">
          <div className="entry">
            <WidgetPrereqs widget={widget} />
            <WidgetSettings widget={widget} config={config} set={set} />
            {settings.length === 0 && (
              <p className="blk-hint">No settings: it finds what it needs.</p>
            )}
          </div>
        </Section>
      )}

      {types.length === 0 && !hasSettings && (
        <Section>
          <Block>
            <p className="blk-hint">This widget has nothing to configure.</p>
          </Block>
        </Section>
      )}
    </article>
  )
}

/** The Add service button and its dropdown: the declared types by name. */
function AddServiceMenu({
  types,
  onAdd,
}: {
  types: WidgetServiceType[]
  onAdd: (t: WidgetServiceType) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <span className="addsvc" ref={ref}>
      <button
        type="button"
        className="btn sm pri"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={12} strokeWidth={1.8} aria-hidden />
        add service
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden />
      </button>
      {open && (
        <span className="addsvc-menu" role="menu">
          {types.map((t) => (
            <button
              key={t.type}
              type="button"
              role="menuitem"
              className="addsvc-item"
              onClick={() => {
                setOpen(false)
                onAdd(t)
              }}
            >
              <WidgetGlyph name={t.icon} size={13} />
              {t.name}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** One configured service: a header that folds, then its fields. */
function ServiceEntry({
  widget,
  svc,
  type,
  startOpen,
  config,
  set,
}: {
  widget: BarWidget
  svc: WidgetService
  type: WidgetServiceType | undefined
  startOpen: boolean
  config: Config
  set: SetFn
}) {
  const [present, setPresent] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const hasSecrets = (type?.settings ?? []).some((s) => s.secret)

  const refresh = useCallback(() => {
    if (!hasSecrets) {
      setLoaded(true)
      return
    }
    invoke<string[]>('widget_secret_keys', { id: widget.id, service: svc.id })
      .then((keys) => setPresent(keys))
      // A service added a moment ago may not be saved yet: nothing is set.
      .catch(() => setPresent([]))
      .finally(() => setLoaded(true))
  }, [widget.id, svc.id, hasSecrets])
  useEffect(refresh, [refresh])

  const missing = serviceMissing(type, svc, present)
  const [open, setOpen] = useState(startOpen)
  // Open by itself once we know it's incomplete; the user's fold wins after.
  const decided = useRef(startOpen)
  useEffect(() => {
    if (!loaded || decided.current) return
    decided.current = true
    if (missing.length) setOpen(true)
  }, [loaded, missing.length])

  const setValue = (key: string, value: string) =>
    set(
      'widgetServices',
      setServiceValue(config.widgetServices, widget.id, svc.id, key, value),
    )
  const setLabel = (label: string) =>
    set(
      'widgetServices',
      updateService(config.widgetServices, widget.id, svc.id, (s) => ({
        ...s,
        label,
      })),
    )
  const saveSecret = (key: string, value: string | null, retried = false) => {
    setNote(null)
    invoke('widget_secret_set', {
      id: widget.id,
      service: svc.id,
      key,
      value,
    })
      .then(refresh)
      .catch((e) => {
        // The config write that creates the service is debounced: try once
        // more after it has landed.
        if (!retried && String(e).includes('has no service')) {
          window.setTimeout(() => saveSecret(key, value, true), 700)
        } else setNote(String(e))
      })
  }
  const remove = async () => {
    // Clear its Keychain items first: the command checks the service exists.
    for (const key of present) {
      await invoke('widget_secret_set', {
        id: widget.id,
        service: svc.id,
        key,
        value: null,
      }).catch(console.error)
    }
    set(
      'widgetServices',
      updateService(config.widgetServices, widget.id, svc.id, () => null),
    )
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="entry svc">
      <button
        type="button"
        className="svc-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <WidgetGlyph name={type?.icon} size={15} />
        <span className="entry-name">
          {svc.label || type?.name || svc.type}
        </span>
        <span className="entry-id">{svc.type}</span>
        <span className={`svc-state${missing.length ? ' warn' : ''}`}>
          {!type
            ? 'unknown type: this widget no longer offers it'
            : missing.length
              ? `needs ${missing.join(', ')}`
              : 'ready'}
        </span>
        <Chevron size={13} strokeWidth={1.8} aria-hidden className="dim" />
      </button>
      {open && (
        <div className="widgetsettings">
          <div className="linkrow widgetsetting">
            <label
              className="widgetsetting-label"
              htmlFor={`svc-${svc.id}-label`}
            >
              Name
            </label>
            <input
              id={`svc-${svc.id}-label`}
              type="text"
              className="grow"
              placeholder={type?.name ?? svc.type}
              value={svc.label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {(type?.settings ?? []).map((s) => (
            <ServiceField
              key={s.key}
              svc={svc}
              setting={s}
              isSet={present.includes(s.key)}
              onPlain={(v) => setValue(s.key, v)}
              onSecret={(v) => saveSecret(s.key, v)}
            />
          ))}
          {(type?.requires ?? []).map((r) => (
            <div className="linkrow widgetsetting" key={r.label}>
              <span className="widgetsetting-label">expects</span>
              <span className="widgetprereq-text">{r.label}</span>
              {r.fix && <code className="widgetprereq-fix">{r.fix}</code>}
            </div>
          ))}
          {note && <p className="note error">{note}</p>}
          <div className="btnrow svc-foot">
            <button
              type="button"
              className="btn dim"
              onClick={() => void remove()}
            >
              remove service
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** One field of a service: plain text bound to config, or a Keychain secret
 * that says "set" once stored and never shows the value again. */
function ServiceField({
  svc,
  setting: s,
  isSet,
  onPlain,
  onSecret,
}: {
  svc: WidgetService
  setting: WidgetSetting
  isSet: boolean
  onPlain: (value: string) => void
  onSecret: (value: string | null) => void
}) {
  const [draft, setDraft] = useState('')
  const id = `svc-${svc.id}-${s.key}`
  const req = s.required && (
    <span className="widgetsetting-req"> · required</span>
  )
  if (!s.secret) {
    return (
      <div className="linkrow widgetsetting">
        <label className="widgetsetting-label" htmlFor={id}>
          {s.label}
          {!svc.values[s.key] && req}
        </label>
        <input
          id={id}
          type="text"
          className="grow"
          placeholder={s.hint ?? s.key}
          value={svc.values[s.key] ?? ''}
          onChange={(e) => onPlain(e.target.value)}
        />
      </div>
    )
  }
  if (isSet) {
    return (
      <div className="linkrow widgetsetting">
        <span className="widgetsetting-label">{s.label}</span>
        <span className="widgetsetting-set">set · in the Keychain</span>
        <button type="button" className="btn" onClick={() => onSecret(null)}>
          clear
        </button>
      </div>
    )
  }
  const save = () => {
    if (!draft) return
    onSecret(draft)
    setDraft('')
  }
  return (
    <div className="linkrow widgetsetting">
      <label className="widgetsetting-label" htmlFor={id}>
        {s.label}
        {req}
      </label>
      <input
        id={id}
        type="password"
        className="grow"
        autoComplete="off"
        placeholder={s.hint ?? s.key}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
      <button type="button" className="btn" disabled={!draft} onClick={save}>
        save
      </button>
    </div>
  )
}
