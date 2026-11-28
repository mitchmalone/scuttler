import { isLightColor, resolveTheme } from '@scuttler/tui/themes'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Config } from './config'
import {
  type AppearanceInputs,
  appearanceInputs,
} from './use-appearance-policy'
import {
  type WallpaperPlan,
  activeFocus,
  focusWallpaperOf,
  wallpaperPlan,
} from './wallpaper'

/** Schedules have minute resolution; re-check on the minute while they matter. */
const TICK_MS = 60_000

/**
 * The wallpaper's runtime half, in the panel window (it lives all session).
 * Plans from the config, Rust's inputs, the clock and the theme in use; sets the
 * picture only when the plan changes. Returns the plan so the theme rung knows
 * whether its backgrounds may cycle. Off (neither feature on) does nothing and
 * runs no timer (invariant 12).
 */
export function useWallpaper(
  config: Config,
  loaded: boolean,
  themes: Parameters<typeof resolveTheme>[1],
): WallpaperPlan {
  const [inputs, setInputs] = useState<AppearanceInputs | null>(null)
  const [now, setNow] = useState(() => new Date())
  const focusOn = focusWallpaperOf(config).enabled

  useEffect(() => {
    if (!loaded) return
    appearanceInputs().then(setInputs).catch(console.error)
    const un = listen<AppearanceInputs>('appearance-input', (e) =>
      setInputs(e.payload),
    )
    return () => {
      un.then((f) => f())
    }
  }, [loaded])

  // Focus reading turns on a beat after the config write; ask again then.
  useEffect(() => {
    if (!loaded || !focusOn) return
    const t = setTimeout(
      () => appearanceInputs().then(setInputs).catch(console.error),
      1500,
    )
    const tick = setInterval(() => setNow(new Date()), TICK_MS)
    return () => {
      clearTimeout(t)
      clearInterval(tick)
    }
  }, [loaded, focusOn])

  const themeDark = !isLightColor(resolveTheme(config.theme, themes).bg)
  const focus = activeFocus(inputs, now)
  const plan = useMemo(
    () => wallpaperPlan(config, focus, themeDark),
    [config, focus, themeDark],
  )

  const applied = useRef<WallpaperPlan | null>(null)
  const key = JSON.stringify(plan)
  useEffect(() => {
    if (!loaded) return
    const previous = applied.current
    applied.current = plan
    if (JSON.stringify(previous) === key || plan.kind === 'off') return
    // The theme's background only needs restoring after an image covered it.
    if (plan.kind === 'theme' && previous?.kind !== 'image') return
    invoke<string | null>('wallpaper_set', {
      path: plan.kind === 'image' ? plan.path : null,
    })
      .then((set) =>
        console.warn(
          `[scuttler wallpaper] ${set ?? 'theme (none)'} (${plan.kind})`,
        ),
      )
      .catch((e) => console.error('[scuttler wallpaper] set failed:', e))
  }, [loaded, key, plan])

  return plan
}
