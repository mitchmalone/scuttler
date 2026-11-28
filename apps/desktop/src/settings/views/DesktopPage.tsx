import {
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_MIN,
  type DesktopConfig,
  MODIFIERS,
  type Modifier,
  clampCornerRadius,
} from '@scuttler/core/desktop'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Config } from '../../lib/config'
import {
  type DesktopStatus,
  type InstallEvent,
  type TomlAction,
  applyDesktop,
  desktopOf,
  desktopStatus,
  planDesktop,
} from '../../lib/desktop'
import { pageDef, rungState } from '../pages'
import type { PageProps } from '../types'
import { Note, Page, Row, RungOff, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/**
 * Settings → Desktop (v0.4, plans/done/v0.4-desktop-aerospace-borders.md): the
 * few knobs scuttler exposes over AeroSpace + JankyBorders, the install rows for
 * either tool when it is missing, the adopt-or-leave choice for a hand-written
 * aerospace.toml, and the system corner-radius slider. Everything else about
 * tiling is opinion; `managed` off hands the file back to a text editor.
 */

const MODIFIER_LABELS: Record<Modifier, string> = {
  alt: '⌥ option',
  ctrl: '⌃ control',
  cmd: '⌘ command',
  'ctrl-alt': '⌃⌥ control + option',
  'alt-shift': '⌥⇧ option + shift',
}

export function DesktopPage({ config, set }: PageProps) {
  const def = pageDef('desktop')
  const desktop = desktopOf(config)
  const setDesktop = (patch: Partial<DesktopConfig>) =>
    set('desktop', { ...desktop, ...patch })
  const setTiling = (patch: Partial<DesktopConfig['tiling']>) =>
    setDesktop({ tiling: { ...desktop.tiling, ...patch } })
  const setBorders = (patch: Partial<DesktopConfig['borders']>) =>
    setDesktop({ borders: { ...desktop.borders, ...patch } })

  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const refresh = useCallback(() => {
    desktopStatus().then(setStatus).catch(console.error)
  }, [])
  useEffect(() => {
    refresh()
    // Re-probe as the config round-trips (the panel webview applies it) so
    // "borders running" and the toml state stay truthful.
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh, config])

  // Install progress: one line at a time from `brew`, last one carries done.
  const [installing, setInstalling] = useState<InstallEvent['dep'] | null>(null)
  const [installLine, setInstallLine] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  useEffect(() => {
    const un = listen<InstallEvent>('desktop-install', (e) => {
      if (e.payload.line) setInstallLine(e.payload.line)
      if (e.payload.done !== null) {
        setInstalling(null)
        setInstallLine(null)
        if (!e.payload.done)
          setInstallError(
            `brew install failed — see the last lines above; try it in a terminal.`,
          )
        refresh()
        // A freshly installed AeroSpace/borders should be picked up now.
        applyDesktop(config).catch(console.error)
      }
    })
    return () => {
      un.then((u) => u())
    }
  }, [refresh, config])
  const install = (dep: InstallEvent['dep']) => {
    setInstallError(null)
    setInstalling(dep)
    setInstallLine('starting brew…')
    invoke('desktop_install', { dep }).catch((e) => {
      setInstalling(null)
      setInstallLine(null)
      setInstallError(String(e?.detail ?? e))
    })
  }

  // Corner radius: applied on release (not every drag tick), read back for truth.
  const [radiusDraft, setRadiusDraft] = useState<number | null>(null)
  const radiusBusy = useRef(false)
  const commitRadius = (value: number | null) => {
    if (radiusBusy.current) return
    radiusBusy.current = true
    invoke('desktop_corner_radius', { radius: value })
      .then(() => setDesktop({ cornerRadius: value }))
      .catch((e) => setInstallError(String(e?.detail ?? e)))
      .finally(() => {
        radiusBusy.current = false
        setRadiusDraft(null)
        refresh()
      })
  }
  const shownRadius = radiusDraft ?? desktop.cornerRadius

  const aerospaceMissing = status !== null && status.aerospace.path === null
  const bordersMissing = status !== null && status.borders.path === null
  const rung = rungState('desktop', config)
  const aerospaceLine = status
    ? status.aerospace.path
      ? `AeroSpace ${status.aerospace.version ?? ''} at ${status.aerospace.path}`
      : 'AeroSpace is not installed.'
    : undefined
  const installAerospace = aerospaceMissing && (
    <InstallRow
      what="AeroSpace"
      dep="aerospace"
      brew={status?.brew ?? false}
      command="brew install --cask nikitabobko/tap/aerospace"
      installing={installing}
      line={installLine}
      onInstall={install}
    />
  )

  return (
    <Page
      icon={PAGE_ICONS.desktop}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
      aside={<span className={`pill ${rung}`}>rung {rung}</span>}
    >
      {!desktop.tiling.enabled ? (
        <Section title="Turning it on" plain>
          <RungOff
            anchor="Tile windows with AeroSpace"
            lines={[
              {
                mark: '+',
                text: 'tiles windows with AeroSpace, from a config scuttler writes and themes',
              },
              {
                mark: '+',
                text: 'then, if you want them, borders on the focused window (JankyBorders)',
              },
              {
                mark: '·',
                text: (
                  <>
                    a hand-written <code>aerospace.toml</code> is never
                    overwritten: you choose to adopt or keep it
                  </>
                ),
              },
              {
                mark: '·',
                text: 'stop letting scuttler manage it and the whole file is yours',
              },
            ]}
            action="Tile windows with AeroSpace"
            onTurnOn={() => setTiling({ enabled: true })}
          >
            {aerospaceLine && <Note>{aerospaceLine}</Note>}
            {installAerospace}
          </RungOff>
        </Section>
      ) : (
        <Section title="Tiling">
          <Row
            label="Tile windows with AeroSpace"
            cfg="tiling.enabled"
            hint={aerospaceLine}
            below={installAerospace || undefined}
          >
            <Toggle
              label="Tile windows with AeroSpace"
              checked={desktop.tiling.enabled}
              onChange={(on) => setTiling({ enabled: on })}
            />
          </Row>
          {status?.toml === 'foreign' && desktop.tiling.managed && (
            <Row
              label="Existing config"
              hint={
                <>
                  You already have a hand-written <code>{status.tomlPath}</code>
                  . scuttler won&apos;t touch it until you choose.
                </>
              }
            >
              <button
                type="button"
                className="btn"
                onClick={() =>
                  invoke<string>('desktop_adopt')
                    .then(() => applyDesktop(config))
                    .then(refresh)
                    .catch((e) => setInstallError(String(e?.detail ?? e)))
                }
              >
                use scuttler&apos;s (backs yours up)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setTiling({ managed: false })}
              >
                keep mine
              </button>
            </Row>
          )}
          <Row
            label="Let scuttler manage AeroSpace"
            cfg="tiling.managed"
            hint="Off hands aerospace.toml back to you and a text editor."
          >
            <Toggle
              label="Let scuttler manage AeroSpace"
              checked={desktop.tiling.managed}
              onChange={(on) => setTiling({ managed: on })}
            />
          </Row>
          {!desktop.tiling.managed && (
            <TomlRow
              status={status}
              config={config}
              onError={setInstallError}
              onDone={refresh}
            />
          )}
          {desktop.tiling.managed && (
            <>
              <Row
                label="Modifier"
                cfg="tiling.modifier"
                hint="Prefix for every tiling key: focus h/j/k/l, move ⇧h/j/k/l, workspaces 1–9, f fullscreen, r resize mode, ; service mode."
              >
                <select
                  aria-label="Modifier"
                  value={desktop.tiling.modifier}
                  onChange={(e) =>
                    setTiling({ modifier: e.target.value as Modifier })
                  }
                >
                  {MODIFIERS.map((m) => (
                    <option key={m} value={m}>
                      {MODIFIER_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Row>
              <Row
                label="Gaps"
                cfg="tiling.gaps"
                hint="The gap you see: between windows, at the screen edges, and below whichever bar is showing. Border width is factored in."
              >
                <input
                  className="tiny center"
                  aria-label="Gaps"
                  type="number"
                  min={0}
                  max={64}
                  value={desktop.tiling.gaps}
                  onChange={(e) => setTiling({ gaps: Number(e.target.value) })}
                />
                <span className="dimtext">px</span>
              </Row>
              <Row
                label="Workspaces"
                cfg="tiling.workspaces"
                hint="Workspaces 1–N stay listed even when empty; keys 1–9 always work."
              >
                <input
                  className="tiny center"
                  aria-label="Workspaces"
                  type="number"
                  min={1}
                  max={9}
                  value={desktop.tiling.workspaces}
                  onChange={(e) =>
                    setTiling({ workspaces: Number(e.target.value) })
                  }
                />
              </Row>
            </>
          )}
        </Section>
      )}

      {desktop.tiling.enabled && (
        <Section title="Borders">
          {bordersMissing ? (
            <Row
              label="Draw a border around the focused window"
              hint="JankyBorders (GPL-3), installed via Homebrew, never bundled."
              below={
                <InstallRow
                  what="JankyBorders"
                  dep="borders"
                  brew={status?.brew ?? false}
                  command="brew install felixkratz/formulae/borders"
                  installing={installing}
                  line={installLine}
                  onInstall={install}
                />
              }
            />
          ) : (
            <>
              <Row
                label="Draw a border around the focused window"
                cfg="borders.enabled"
                hint={
                  status
                    ? `JankyBorders ${status.borders.version ?? ''}${status.bordersRunning ? ' · running' : ''}. Colours follow the theme: accent when focused, dim otherwise.`
                    : 'Colours follow the theme: accent when focused, dim otherwise.'
                }
              >
                <Toggle
                  label="Draw a border around the focused window"
                  checked={desktop.borders.enabled}
                  onChange={(on) => setBorders({ enabled: on })}
                />
              </Row>
              {desktop.borders.enabled && (
                <>
                  <Row label="Width" cfg="borders.width">
                    <input
                      className="tiny center"
                      aria-label="Border width"
                      type="number"
                      min={1}
                      max={20}
                      step={0.5}
                      value={desktop.borders.width}
                      onChange={(e) =>
                        setBorders({ width: Number(e.target.value) })
                      }
                    />
                    <span className="dimtext">px</span>
                  </Row>
                  <Row label="Style" cfg="borders.style">
                    <select
                      aria-label="Border style"
                      className="narrow"
                      value={desktop.borders.style}
                      onChange={(e) =>
                        setBorders({
                          style:
                            e.target.value === 'square' ? 'square' : 'round',
                        })
                      }
                    >
                      <option value="round">round</option>
                      <option value="square">square</option>
                    </select>
                  </Row>
                </>
              )}
            </>
          )}
        </Section>
      )}

      <Section title="macOS">
        <Row
          label="Override macOS’s window corner radius"
          cfg="cornerRadius"
          hint={
            <>
              Sets a hidden system default (<code>NSConvolutionOverride1</code>
              ); apps pick it up when they relaunch, Finder after a logout.
              Undocumented by Apple, so it may stop working on a future macOS.
              10 is the pre-Tahoe look
              {status?.cornerRadius !== null &&
              status?.cornerRadius !== undefined
                ? `; currently ${status.cornerRadius}`
                : ''}
              .
            </>
          }
          below={
            desktop.cornerRadius !== null && (
              <div className="btnrow">
                <input
                  type="range"
                  aria-label="Corner radius"
                  className="grow"
                  min={CORNER_RADIUS_MIN}
                  max={CORNER_RADIUS_MAX}
                  step={1}
                  value={shownRadius ?? 10}
                  onChange={(e) =>
                    setRadiusDraft(clampCornerRadius(Number(e.target.value)))
                  }
                  onMouseUp={() =>
                    radiusDraft !== null && commitRadius(radiusDraft)
                  }
                  onKeyUp={() =>
                    radiusDraft !== null && commitRadius(radiusDraft)
                  }
                  onTouchEnd={() =>
                    radiusDraft !== null && commitRadius(radiusDraft)
                  }
                />
                <span className="dimtext">{shownRadius ?? 10}px</span>
              </div>
            )
          }
        >
          <Toggle
            label="Override macOS’s window corner radius"
            checked={desktop.cornerRadius !== null}
            onChange={(on) => commitRadius(on ? 10 : null)}
          />
        </Row>
      </Section>

      {installError && <Note tone="error">{installError}</Note>}
    </Page>
  )
}

/**
 * Unmanaged: the file is yours. Show what's at the canonical path and offer the
 * two hand-offs — point it at a toml you already keep (symlink), or save
 * scuttler's config somewhere as a starting point (then it's yours).
 */
function TomlRow({
  status,
  config,
  onError,
  onDone,
}: {
  status: DesktopStatus | null
  config: Config
  onError: (e: string | null) => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const run = (action: TomlAction) => {
    setBusy(true)
    onError(null)
    invoke<string | null>('desktop_toml', { action })
      .then(() => onDone())
      .catch((e) => onError(String(e?.detail ?? e)))
      .finally(() => setBusy(false))
  }
  const state = status?.toml
  const path = status?.tomlPath ?? '~/.config/aerospace/aerospace.toml'
  return (
    <Row
      label="Config file"
      hint={
        <>
          {state === 'absent' && (
            <>
              Nothing at <code>{path}</code> yet; AeroSpace runs on its
              defaults.{' '}
            </>
          )}
          {state === 'foreign' && (
            <>
              <code>{path}</code> is yours; scuttler won&apos;t touch it.{' '}
            </>
          )}
          {state === 'managed' && (
            <>
              <code>{path}</code> is the last file scuttler wrote, yours
              now.{' '}
            </>
          )}
          &ldquo;Use my own&rdquo; symlinks it to a file you pick
          (dotfiles-friendly; anything already there is backed up). &ldquo;Save
          a copy&rdquo; writes scuttler&apos;s config where you choose and links
          to it.
        </>
      }
      below={
        <div className="btnrow">
          {state !== 'absent' && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                invoke('open_path', { target: 'aerospace-toml' }).catch((e) =>
                  onError(String(e?.detail ?? e)),
                )
              }
            >
              edit
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run({ kind: 'useExisting' })}
          >
            use my own config…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              const toml = planDesktop(
                {
                  ...config,
                  desktop: {
                    ...desktopOf(config),
                    tiling: { ...desktopOf(config).tiling, managed: true },
                  },
                },
                { menuBarHidden: status?.menuBarHidden ?? true },
              ).toml
              if (toml) run({ kind: 'saveAs', toml })
            }}
          >
            save a copy to edit…
          </button>
        </div>
      }
    />
  )
}

function InstallRow({
  what,
  dep,
  brew,
  command,
  installing,
  line,
  onInstall,
}: {
  what: string
  dep: InstallEvent['dep']
  brew: boolean
  command: string
  installing: InstallEvent['dep'] | null
  line: string | null
  onInstall: (dep: InstallEvent['dep']) => void
}) {
  if (installing === dep) {
    return (
      <Note>
        Installing {what}… <code>{line ?? ''}</code>
      </Note>
    )
  }
  if (!brew) {
    return (
      <Note>
        Homebrew isn&apos;t installed. Get it from <code>https://brew.sh</code>,
        then run <code>{command}</code>.
      </Note>
    )
  }
  return (
    <div className="btnrow">
      <button
        type="button"
        className="btn"
        disabled={installing !== null}
        onClick={() => onInstall(dep)}
      >
        install {what} via Homebrew
      </button>
    </div>
  )
}
