import type { BarWidget } from '@scuttler/tui'
import type { PluginPermission, PluginState } from '@scuttler/tui/plugins'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

import { pluginModuleId } from '../../lib/config'
import { usePlugins } from '../../plugins/use-plugins'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'
import { WidgetPrereqs, WidgetSettings } from './widget-kit'

/**
 * Settings → Plugins (docs/PLUGINS.md): what's installed — bundled and user —
 * how each is doing (service, build, last state), on/off, restart, install
 * from a git URL, remove. Settings/prereqs render through the widget kit: a
 * plugin declares them the same way a widget does.
 */
export function PluginsPage({ config, set }: PageProps) {
  const def = pageDef('plugins')
  const plugins = usePlugins(2000)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const now = Date.now()

  const install = () => {
    const u = url.trim()
    if (!u) return
    setBusy(true)
    setNote(`cloning ${u}…`)
    invoke<string>('plugin_install', { url: u })
      .then((id) => {
        setNote(`installed ${id}`)
        setUrl('')
      })
      .catch((e) => setNote(String(e)))
      .finally(() => setBusy(false))
  }
  const remove = (p: PluginState) => {
    setNote(null)
    invoke('plugin_remove', { id: p.id })
      .then(() => setNote(`removed ${p.id}`))
      .catch((e) => setNote(String(e)))
  }
  const restart = (p: PluginState) =>
    invoke('plugin_restart', { id: p.id }).catch((e) => setNote(String(e)))
  const toggle = (p: PluginState, on: boolean) => {
    const disabled = config.plugins.disabled.filter((id) => id !== p.id)
    if (!on) disabled.push(p.id)
    set('plugins', { ...config.plugins, disabled })
  }

  return (
    <Page
      icon={PAGE_ICONS.plugins}
      title={def.label}
      description={
        <>
          Directories in <code>~/.config/scuttler/plugins/</code>: a manifest, a
          Bun service, and a cell and panel written in React on the scuttler
          kit. Bundled ones ship with the app. Contract and reference plugins:
          docs/PLUGINS.md.
        </>
      }
      configKey={def.configKey}
    >
      <Section title="Installed" aside={`${plugins.length}`}>
        <span data-row="installed-plugins" />
        {plugins.length === 0 && (
          <Block>
            <p className="blk-hint">No plugins found.</p>
          </Block>
        )}
        {plugins.map((p) => (
          <div className="entry" key={p.id}>
            <div className="entry-head">
              <Toggle
                label={`Enable ${p.name}`}
                checked={p.enabled}
                onChange={(on) => toggle(p, on)}
              />
              <div className="entry-meta">
                <span className="entry-name">{p.name}</span>
                <span className="entry-id">
                  {pluginModuleId(p.id)}
                  {p.version ? ` · v${p.version}` : ''}
                  {p.firstParty ? ' · bundled' : ''}
                </span>
                <span
                  className={`entry-status${
                    p.error || p.buildError ? ' error' : ''
                  }`}
                  title={p.buildError ?? p.error ?? undefined}
                >
                  {pluginStatus(p, now)}
                </span>
              </div>
              {!p.firstParty && (
                <button
                  type="button"
                  className="btn"
                  title="restart the service, rebuild the UI"
                  onClick={() => restart(p)}
                >
                  restart
                </button>
              )}
              {!p.firstParty && (
                <button
                  type="button"
                  className="btn dim"
                  title="delete the plugin directory"
                  onClick={() => remove(p)}
                >
                  remove
                </button>
              )}
            </div>
            {p.description && <p className="entry-desc">{p.description}</p>}
            <PluginPermissions plugin={p} />
            <WidgetPrereqs widget={asWidget(p)} />
            <WidgetSettings widget={asWidget(p)} config={config} set={set} />
          </div>
        ))}
      </Section>

      <Section title="Add">
        <Block anchor="Install a plugin">
          <div className="btnrow">
            <input
              type="text"
              className="grow"
              aria-label="Plugin git URL"
              placeholder="https://github.com/…/scuttler-plugin.git"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') install()
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !url.trim()}
              onClick={install}
            >
              install from git
            </button>
            <button
              type="button"
              className="btn dim"
              onClick={() => invoke('open_path', { target: 'plugins' })}
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

/** One word per status for the row; the fix text carries the detail. */
function permissionWord(s: PluginPermission['status']): string {
  switch (s) {
    case 'granted':
      return 'allowed'
    case 'denied':
      return 'denied'
    case 'not-determined':
      return 'not asked yet'
    case 'missing-usage-string':
      return 'this build cannot ask'
    case 'unknown':
      return 'asked on use'
  }
}

/**
 * Declared permissions (manifest `permissions`) with what macOS says about
 * each — visible before enabling, so the ask is never a surprise. A
 * non-granted one gets a button: ask macOS, or open the Privacy pane.
 */
function PluginPermissions({ plugin }: { plugin: PluginState }) {
  const [note, setNote] = useState<string | null>(null)
  const perms = plugin.permissions ?? []
  if (!perms.length) return null
  const act = (perm: PluginPermission) => {
    setNote(null)
    invoke<string>('plugin_permission_fix', { id: plugin.id, name: perm.name })
      .then(setNote)
      .catch((e) => setNote(String(e)))
  }
  return (
    <div className="widgetsettings">
      {perms.map((perm) => {
        const bad =
          perm.status === 'denied' || perm.status === 'missing-usage-string'
        return (
          <div className="linkrow widgetsetting" key={perm.name}>
            <span
              className={`widgetsetting-label ${bad ? 'widgetsetting-req' : ''}`}
            >
              uses
            </span>
            <span className="widgetprereq-text" title={perm.fix ?? undefined}>
              {perm.label} · {permissionWord(perm.status)}
            </span>
            {perm.status !== 'granted' && perm.status !== 'unknown' && (
              <button
                type="button"
                className="btn widgetfix"
                title={perm.fix ?? undefined}
                onClick={() => act(perm)}
              >
                {perm.status === 'not-determined'
                  ? 'ask now'
                  : perm.status === 'denied'
                    ? 'open privacy settings'
                    : 'needs a rebuild'}
              </button>
            )}
          </div>
        )
      })}
      {note && <Note>{note}</Note>}
    </div>
  )
}

/** The plugin in the widget row's shape, for the shared settings/prereq UI. */
function asWidget(p: PluginState): BarWidget {
  return {
    id: p.id,
    name: p.name,
    zone: p.zone,
    icon: p.icon,
    view: null,
    error: p.error,
    lastOk: p.lastOk,
    updatedAt: p.updatedAt,
    settings: p.settings,
    auth: p.auth,
    requires: p.requires,
    needs: p.needs,
  }
}

/** "running · 3m ago" / "build failed · …" / "off" for the list. */
export function pluginStatus(p: PluginState, nowMs: number): string {
  const ago = (t: number) => {
    const s = Math.max(0, Math.round(nowMs / 1000 - t))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.round(s / 60)}m ago`
    return `${Math.round(s / 3600)}h ago`
  }
  if (!p.enabled) return 'off'
  if (p.buildError) return `build failed · ${p.buildError}`
  if (p.needs?.length) return `needs setup · ${p.needs.join(', ')}`
  if (p.error) {
    return `error · ${p.error}${p.lastOk ? ` · last ok ${ago(p.lastOk)}` : ''}`
  }
  const at = p.updatedAt ? ` · ${ago(p.updatedAt)}` : ''
  if (p.firstParty) return 'bundled'
  if (p.running)
    return `running${at}${p.restarts ? ` · ${p.restarts} restarts` : ''}`
  if (p.interval) return p.state ? `ok${at}` : 'waiting for the first tick'
  if (!p.hasService)
    return p.hasCell || p.hasPanel ? 'ui only' : 'no service, no ui'
  return p.state ? `stopped${at}` : 'starting…'
}
