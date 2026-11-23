/**
 * Which wallpaper, and when (DECISIONS 2026-11-23). Pure: the panel window's
 * `useWallpaper` feeds it Rust's inputs and the clock, and hands the answer to
 * `wallpaper_set`. Two features meet here:
 *
 * - **Wallpaper** — the default: a light and a dark image, swapped with the
 *   theme (whichever half the theme in use is). `null` leaves it to the theme's
 *   own backgrounds.
 * - **Focus mode wallpaper** — one image per Focus; while that Focus is on it
 *   wins. A Focus with no image leaves the default alone.
 */
import {
  type Config,
  DEFAULT_FOCUS_WALLPAPER,
  DEFAULT_WALLPAPER,
  type FocusWallpaperConfig,
  type WallpaperConfig,
} from './config'
import type { AppearanceInputs, FocusSchedule } from './use-appearance-policy'

export const wallpaperOf = (config: Config): WallpaperConfig => ({
  ...DEFAULT_WALLPAPER,
  ...(config.wallpaper ?? {}),
})

export const focusWallpaperOf = (config: Config): FocusWallpaperConfig => ({
  ...DEFAULT_FOCUS_WALLPAPER,
  ...(config.focusWallpaper ?? {}),
  modes: { ...(config.focusWallpaper?.modes ?? {}) },
})

const DAY_MS = 24 * 60 * 60 * 1000

/** Monday = 0, like `FocusSchedule.days`. */
const weekday = (d: Date) => (d.getDay() + 6) % 7

/**
 * When the schedule window containing `now` began (local time), or null when
 * `now` is outside it. A window whose end is before its start runs overnight
 * and belongs to the day it started. Equal start and end never runs.
 */
export function windowStart(s: FocusSchedule, now: Date): Date | null {
  const t = now.getHours() * 60 + now.getMinutes()
  const at = (day: Date, minutes: number) => {
    const d = new Date(day)
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    return d
  }
  if (s.start === s.end) return null
  if (s.start < s.end) {
    return s.days.includes(weekday(now)) && t >= s.start && t < s.end
      ? at(now, s.start)
      : null
  }
  if (t >= s.start && s.days.includes(weekday(now))) return at(now, s.start)
  const yesterday = new Date(now.getTime() - DAY_MS)
  if (t < s.end && s.days.includes(weekday(yesterday)))
    return at(yesterday, s.start)
  return null
}

/**
 * The Focus that is on right now. One turned on by hand (or synced) is in the
 * database; one a schedule turned on is in no file, so the schedules are
 * evaluated here — unless Focus was turned off by hand after that window began.
 * Smart Activation can't be seen at all.
 */
export function activeFocus(
  inputs: AppearanceInputs | null,
  now: Date,
): string | null {
  if (!inputs || inputs.focusAccess !== 'granted') return null
  if (inputs.assertedFocus) return inputs.assertedFocus
  const cleared = inputs.focusClearedAt ?? -Infinity
  for (const mode of inputs.modes) {
    for (const s of mode.schedules) {
      const began = windowStart(s, now)
      if (began && began.getTime() / 1000 > cleared) return mode.id
    }
  }
  return null
}

export type WallpaperPlan =
  | { kind: 'image'; path: string; why: 'focus' | 'light' | 'dark' }
  /** The theme's own backgrounds decide (`wallpaper_set(null)` restores them). */
  | { kind: 'theme' }
  /** Neither feature is on: scuttler leaves the wallpaper alone. */
  | { kind: 'off' }

export function wallpaperPlan(
  config: Config,
  focus: string | null,
  themeDark: boolean,
): WallpaperPlan {
  const byFocus = focusWallpaperOf(config)
  const image = focus ? byFocus.modes[focus] : undefined
  if (byFocus.enabled && image)
    return { kind: 'image', path: image, why: 'focus' }
  const def = wallpaperOf(config)
  if (!def.enabled) return { kind: byFocus.enabled ? 'theme' : 'off' }
  const half = themeDark ? 'dark' : 'light'
  const path = def[half]
  return path ? { kind: 'image', path, why: half } : { kind: 'theme' }
}

/** The theme rung may cycle its backgrounds only when no image owns the desktop. */
export const themeOwnsWallpaper = (plan: WallpaperPlan) => plan.kind !== 'image'
