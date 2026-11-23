import { describe, expect, it } from 'vitest'

import type { Config } from './config'
import type { AppearanceInputs } from './use-appearance-policy'
import { activeFocus, wallpaperPlan, windowStart } from './wallpaper'

const WORK = 'com.apple.focus.work'
const workdays = { start: 9 * 60, end: 17 * 60, days: [0, 1, 2, 3, 4] }

/** Monday 23 Nov 2026 at hh:mm, local time. */
const mon = (h: number, m = 0) => new Date(2026, 10, 23, h, m)
const sat = (h: number) => new Date(2026, 10, 28, h)

const inputs = (over: Partial<AppearanceInputs> = {}): AppearanceInputs => ({
  systemDark: true,
  focusAccess: 'granted',
  assertedFocus: null,
  focusClearedAt: null,
  modes: [{ id: WORK, name: 'Work', schedules: [workdays], smart: false }],
  ...over,
})

describe('windowStart', () => {
  it('is inside a same-day window on a listed day only', () => {
    expect(windowStart(workdays, mon(12))).toEqual(mon(9))
    expect(windowStart(workdays, mon(8, 59))).toBeNull()
    expect(windowStart(workdays, mon(17))).toBeNull()
    expect(windowStart(workdays, sat(12))).toBeNull()
  })

  it('runs an overnight window into the next morning', () => {
    const night = { start: 22 * 60, end: 6 * 60, days: [0] } // Monday night
    expect(windowStart(night, mon(23))).toEqual(mon(22))
    // Tuesday 03:00 belongs to Monday's window.
    expect(windowStart(night, new Date(2026, 10, 24, 3))).toEqual(mon(22))
    expect(windowStart(night, new Date(2026, 10, 24, 23))).toBeNull()
  })

  it('never runs when start equals end', () => {
    expect(windowStart({ start: 60, end: 60, days: [0] }, mon(1))).toBeNull()
  })
})

describe('activeFocus', () => {
  it('is nothing without access', () => {
    expect(activeFocus(inputs({ focusAccess: 'denied' }), mon(12))).toBeNull()
    expect(activeFocus(inputs({ focusAccess: 'off' }), mon(12))).toBeNull()
    expect(activeFocus(null, mon(12))).toBeNull()
  })

  it('prefers a Focus turned on by hand', () => {
    expect(activeFocus(inputs({ assertedFocus: 'personal' }), mon(12))).toBe(
      'personal',
    )
  })

  it('evaluates schedules, which no file records', () => {
    expect(activeFocus(inputs(), mon(12))).toBe(WORK)
    expect(activeFocus(inputs(), mon(18))).toBeNull()
  })

  it('honours turning Focus off by hand after the window began', () => {
    const offAt = (d: Date) => d.getTime() / 1000
    expect(
      activeFocus(inputs({ focusClearedAt: offAt(mon(9, 39)) }), mon(12)),
    ).toBeNull()
    // Turned off last week: today's window still runs.
    expect(
      activeFocus(
        inputs({ focusClearedAt: offAt(new Date(2026, 10, 20, 10)) }),
        mon(12),
      ),
    ).toBe(WORK)
  })
})

describe('wallpaperPlan', () => {
  const config = (over: Partial<Config>): Config =>
    ({ theme: 'scuttler', themes: {}, ...over }) as Config

  it('is off unless a feature is on', () => {
    expect(wallpaperPlan(config({}), WORK, true)).toEqual({ kind: 'off' })
  })

  it('swaps the default with the theme, or defers to the theme', () => {
    const c = config({
      wallpaper: { enabled: true, light: '/day.heic', dark: null },
    })
    expect(wallpaperPlan(c, null, false)).toEqual({
      kind: 'image',
      path: '/day.heic',
      why: 'light',
    })
    expect(wallpaperPlan(c, null, true)).toEqual({ kind: 'theme' })
  })

  it('lets a Focus with an image win, and one without leave the default', () => {
    const c = config({
      wallpaper: { enabled: true, light: '/day.heic', dark: '/night.heic' },
      focusWallpaper: { enabled: true, modes: { [WORK]: '/office.jpg' } },
    })
    expect(wallpaperPlan(c, WORK, false)).toEqual({
      kind: 'image',
      path: '/office.jpg',
      why: 'focus',
    })
    expect(wallpaperPlan(c, 'personal', true)).toEqual({
      kind: 'image',
      path: '/night.heic',
      why: 'dark',
    })
  })

  it('restores the theme’s background after a Focus when the default is off', () => {
    const c = config({
      focusWallpaper: { enabled: true, modes: { [WORK]: '/office.jpg' } },
    })
    expect(wallpaperPlan(c, null, true)).toEqual({ kind: 'theme' })
  })
})
