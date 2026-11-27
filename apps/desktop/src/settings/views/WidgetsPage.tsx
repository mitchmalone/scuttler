import type { BarWidget } from '@scuttler/tui'
import { invoke } from '@tauri-apps/api/core'
import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { widgetModuleId } from '../../lib/config'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Section } from '../ui'
import { WidgetConfigure } from './WidgetConfigure'
import { PAGE_ICONS } from './icons'
import { useWidgets, widgetStatus } from './widget-kit'

type WidgetSource =
  { kind: 'url'; url: string } | { kind: 'file'; name: string; content: string }

/** What a widget's configure screen holds, in one line for the inventory. */
function widgetSummary(w: BarWidget, config: PageProps['config']): string {
  const services = config.widgetServices?.[w.id] ?? []
  if (w.services?.length) {
    if (!services.length) return 'no services yet'
    const names = services.map((s) => s.label || s.type).join(', ')
    return `${services.length} ${services.length === 1 ? 'service' : 'services'}: ${names}`
  }
  const n = w.settings?.length ?? 0
  return n ? `${n} ${n === 1 ? 'setting' : 'settings'}` : 'nothing to configure'
}

/**
 * Settings → Widgets: what's installed and how it's doing, plus add (a picked
 * file — read in the webview, no dialog plugin — or a URL, one user-initiated
 * fetch) and remove. Layout lives on the Bar page; this is the inventory.
 * Each widget's settings and services live on its own configure screen
 * (WidgetConfigure, DECISIONS 2026-11-27).
 */
export function WidgetsPage({ config, set }: PageProps) {
  const def = pageDef('widgets')
  const widgets = useWidgets()
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const now = Date.now()

  const install = (source: WidgetSource) => {
    setBusy(true)
    setNote(null)
    invoke<string>('widget_install', { source })
      .then((id) => {
        setNote(`installed ${id}`)
        setUrl('')
      })
      .catch((e) => setNote(String(e)))
      .finally(() => setBusy(false))
  }
  const pickFile = (file: File | undefined) => {
    if (!file) return
    file
      .text()
      .then((content) => install({ kind: 'file', name: file.name, content }))
      .catch((e) => setNote(String(e)))
  }
  const remove = (w: BarWidget) => {
    setNote(null)
    invoke('widget_remove', { id: w.id })
      .then(() => setNote(`removed ${w.id}`))
      .catch((e) => setNote(String(e)))
  }
  const tick = (w: BarWidget) =>
    invoke('widget_tick', { id: w.id }).catch(console.error)

  const open = widgets.find((w) => w.id === configuring)
  if (open) {
    return (
      <WidgetConfigure
        widget={open}
        config={config}
        set={set}
        onBack={() => setConfiguring(null)}
      />
    )
  }

  return (
    <Page
      icon={PAGE_ICONS.widgets}
      title={def.label}
      description={
        <>
          Executables in <code>~/.config/scuttler/widgets/</code> that answer{' '}
          <code>manifest</code> and <code>tick</code>: any language, live, no
          restart. Contract and reference widgets: docs/WIDGETS.md.
        </>
      }
      configKey={def.configKey}
    >
      <Section title="Installed" aside={`${widgets.length}`}>
        <span data-row="installed-widgets" />
        {widgets.length === 0 && (
          <Block>
            <p className="blk-hint">
              No custom widgets installed. They join the bar&apos;s zones as
              soon as they are.
            </p>
          </Block>
        )}
        {widgets.map((w) => (
          <div className="entry" key={w.id}>
            <div className="entry-head">
              <div className="entry-meta">
                <span className="entry-name">{w.name}</span>
                <span className="entry-id">{widgetModuleId(w.id)}</span>
                <span
                  className={`entry-status${w.error ? ' error' : ''}`}
                  title={w.error ?? undefined}
                >
                  {widgetStatus(w, now)}
                </span>
              </div>
              <button
                type="button"
                className="btn pri"
                onClick={() => setConfiguring(w.id)}
              >
                configure
                <ChevronRight size={12} strokeWidth={1.8} aria-hidden />
              </button>
              <button
                type="button"
                className="btn"
                title="run the widget now"
                onClick={() => tick(w)}
              >
                tick
              </button>
              <button
                type="button"
                className="btn dim"
                title="delete the widget file"
                onClick={() => remove(w)}
              >
                remove
              </button>
            </div>
            <div className="entry-desc">{widgetSummary(w, config)}</div>
          </div>
        ))}
      </Section>

      <Section title="Add">
        <Block anchor="Install a widget">
          <div className="btnrow">
            <input
              type="text"
              className="grow"
              aria-label="Widget URL"
              placeholder="https://…/widget.py"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) {
                  install({ kind: 'url', url: url.trim() })
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !url.trim()}
              onClick={() => install({ kind: 'url', url: url.trim() })}
            >
              install from URL
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              add file…
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="btn dim"
              onClick={() => invoke('open_path', { target: 'widgets' })}
            >
              open folder
            </button>
          </div>
          {note && <Note>{note}</Note>}
        </Block>
      </Section>
    </Page>
  )
}
