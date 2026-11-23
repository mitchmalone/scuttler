import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import type { FocusWallpaperConfig } from '../../lib/config'
import type {
  FocusModeInfo,
  FocusSchedule,
} from '../../lib/use-appearance-policy'
import { activeFocus, focusWallpaperOf } from '../../lib/wallpaper'
import { pageDef, rungState } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Row, RungOff, Section, Toggle } from '../ui'
import { Thumb } from './Thumb'
import { PAGE_ICONS } from './icons'
import { useAppearanceInputs } from './use-inputs'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const clock = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** "weekdays 09:00–17:00", "every day 22:00–06:00", "Sat, Sun 10:00–14:00". */
export function scheduleText(s: FocusSchedule): string {
  const days = [...s.days].sort().join(',')
  const when =
    days === '0,1,2,3,4,5,6'
      ? 'every day'
      : days === '0,1,2,3,4'
        ? 'weekdays'
        : days === '5,6'
          ? 'weekends'
          : s.days.map((d) => DAY_NAMES[d]).join(', ')
  return `${when} ${clock(s.start)}–${clock(s.end)}`
}

/**
 * Settings → Focus mode wallpaper (DECISIONS 2026-11-23): one image per macOS
 * Focus, overriding the default while that Focus is on. Off by default and
 * asked as a question; on is consent to read the Focus database, which macOS
 * keeps behind Full Disk Access — the user grants it as they turn this on.
 */
export function FocusWallpaperPage({ config, set }: PageProps) {
  const def = pageDef('focuswallpaper')
  const fw = focusWallpaperOf(config)
  const { inputs, refresh } = useAppearanceInputs()
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!fw.enabled) return
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [fw.enabled])
  // Turning on reaches Rust a beat after the config write; ask again then.
  useEffect(() => {
    if (!fw.enabled) return
    const t = setTimeout(refresh, 1500)
    return () => clearTimeout(t)
  }, [fw.enabled, refresh])

  const setFocus = (p: Partial<FocusWallpaperConfig>) =>
    set('focusWallpaper', { ...fw, ...p })
  const openAccess = () =>
    invoke('open_path', { target: 'full-disk-access' }).catch((e) =>
      setError(String(e)),
    )
  const pick = (id: string) => {
    setError(null)
    invoke<string | null>('wallpaper_pick')
      .then((path) => path && setFocus({ modes: { ...fw.modes, [id]: path } }))
      .catch((e) => setError(String(e)))
  }
  const clear = (id: string) => {
    const modes = { ...fw.modes }
    delete modes[id]
    setFocus({ modes })
  }
  const rung = rungState('focuswallpaper', config)

  if (!fw.enabled) {
    return (
      <Page
        icon={PAGE_ICONS.focuswallpaper}
        title={def.label}
        description={def.description}
        configKey={def.configKey}
        aside={<span className={`pill ${rung}`}>{rung}</span>}
      >
        <Section title="Turning it on" plain>
          <RungOff
            anchor="Focus mode wallpaper"
            question="Would you like scuttler to manage your wallpaper based on your Focus mode?"
            lines={[
              {
                mark: '+',
                text: 'each Focus can have its own wallpaper; it replaces your default while that Focus is on',
              },
              {
                mark: '+',
                text: 'when the Focus ends, your default wallpaper comes back (Settings › Wallpaper)',
              },
              {
                mark: '+',
                text: (
                  <>
                    to know which Focus is on, scuttler reads macOS&apos;s Focus
                    database, which macOS keeps behind{' '}
                    <strong>Full Disk Access</strong>: System Settings opens
                    next so you can allow it
                  </>
                ),
              },
              {
                mark: '·',
                text: 'a Focus you leave empty changes nothing; turning this off stops the reading',
              },
            ]}
            action="Yes, manage my wallpaper by Focus mode"
            onTurnOn={() => {
              setFocus({ enabled: true })
              openAccess()
            }}
          />
        </Section>
      </Page>
    )
  }

  const access = inputs?.focusAccess ?? 'off'
  const on = activeFocus(inputs, now)
  const modes = inputs?.modes ?? []
  const status = (m: FocusModeInfo) => {
    const parts: string[] = []
    if (m.id === on) parts.push('on now')
    parts.push(...m.schedules.map(scheduleText))
    if (m.smart) parts.push('Smart Activation (scuttler can’t see it)')
    return parts.join(' · ') || 'no schedule: on when you turn it on'
  }

  return (
    <Page
      icon={PAGE_ICONS.focuswallpaper}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
      aside={
        on ? (
          <span className="pill on">
            {modes.find((m) => m.id === on)?.name ?? on} · on now
          </span>
        ) : undefined
      }
    >
      <Section>
        <Row
          label="Focus mode wallpaper"
          cfg="enabled"
          hint="Off stops reading the Focus database; your default wallpaper takes over."
        >
          <Toggle
            label="Focus mode wallpaper"
            checked
            onChange={() => setFocus({ enabled: false })}
          />
        </Row>
        <Row
          label="Full Disk Access"
          hint={
            access === 'granted'
              ? 'Allowed. scuttler reads the Focus database and nothing else.'
              : access === 'denied'
                ? 'Not allowed yet: scuttler can’t see your Focus. Turn scuttler on in System Settings › Privacy & Security › Full Disk Access, then check again.'
                : 'Checking…'
          }
        >
          <span className={`pill ${access === 'granted' ? 'on' : ''}`}>
            {access === 'granted'
              ? 'allowed'
              : access === 'denied'
                ? 'not allowed'
                : '…'}
          </span>
          {access !== 'granted' && (
            <>
              <button type="button" className="btn" onClick={openAccess}>
                open System Settings
              </button>
              <button type="button" className="btn dim" onClick={refresh}>
                check again
              </button>
            </>
          )}
        </Row>
      </Section>

      {access === 'granted' && (
        <Section
          title="Focus modes"
          aside={`${modes.length} found · ${Object.keys(fw.modes).length} with a wallpaper`}
        >
          <span data-row="focus-modes" />
          {modes.length === 0 ? (
            <Block>
              <p className="blk-hint">
                No Focus modes yet. Set them up in System Settings › Focus.
              </p>
            </Block>
          ) : (
            modes.map((m) => (
              <Row
                key={m.id}
                label={m.name}
                hint={
                  <span className={m.id === on ? 'goodtext' : undefined}>
                    {status(m)}
                  </span>
                }
              >
                <Thumb
                  path={fw.modes[m.id] ?? null}
                  empty="default"
                  className="small"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => pick(m.id)}
                >
                  {fw.modes[m.id] ? 'change…' : 'choose…'}
                </button>
                {fw.modes[m.id] && (
                  <button
                    type="button"
                    className="btn dim"
                    onClick={() => clear(m.id)}
                  >
                    clear
                  </button>
                )}
              </Row>
            ))
          )}
        </Section>
      )}

      {access === 'granted' && (
        <Today modes={modes} images={fw.modes} now={now} />
      )}
      {error && <Note tone="error">{error}</Note>}
    </Page>
  )
}

/** A day at a glance: each scheduled Focus as a band, and what the desktop
 * shows. A Focus turned on by hand or by Smart Activation isn't predictable. */
function Today({
  modes,
  images,
  now,
}: {
  modes: FocusModeInfo[]
  images: Record<string, string>
  now: Date
}) {
  const today = (now.getDay() + 6) % 7
  const yesterday = (today + 6) % 7
  const pct = (m: number) => `${(m / 1440) * 100}%`
  const bands = modes.flatMap((m) =>
    m.schedules.flatMap((s) => {
      const out: { from: number; to: number }[] = []
      if (s.start < s.end && s.days.includes(today))
        out.push({ from: s.start, to: s.end })
      if (s.start > s.end) {
        if (s.days.includes(yesterday)) out.push({ from: 0, to: s.end })
        if (s.days.includes(today)) out.push({ from: s.start, to: 1440 })
      }
      return out.map((b) => ({ ...b, mode: m }))
    }),
  )
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return (
    <Section title="Today" aside="schedules only">
      <Block anchor="Today">
        {bands.length === 0 ? (
          <p className="blk-hint">
            No Focus is scheduled today. One you turn on by hand still changes
            the wallpaper.
          </p>
        ) : (
          <div className="timeline">
            {[...new Set(bands.map((b) => b.mode.id))].map((id) => (
              <div className="lane" key={id}>
                <span className="lane-name">
                  {bands.find((b) => b.mode.id === id)?.mode.name}
                </span>
                <div className="track">
                  {bands
                    .filter((b) => b.mode.id === id)
                    .map((b, i) => (
                      <div
                        key={i}
                        className={`band${images[id] ? ' img' : ''}`}
                        style={{ left: pct(b.from), width: pct(b.to - b.from) }}
                        title={`${clock(b.from)}–${clock(b.to)}`}
                      >
                        {images[id]?.split('/').pop() ?? 'default wallpaper'}
                      </div>
                    ))}
                  <div className="nowline" style={{ left: pct(nowMin) }} />
                </div>
              </div>
            ))}
            <div className="lane axis">
              <span />
              <div>
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
            </div>
          </div>
        )}
      </Block>
    </Section>
  )
}
