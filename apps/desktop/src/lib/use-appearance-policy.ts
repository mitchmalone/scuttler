import { type PolicyInputs, toggleMode } from '@scuttler/core/appearance'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'

import type { Config } from './config'
import { updateConfig } from './config-write'
import { appearanceOf, policyConfigured, policyResolution } from './theme'

/** Whether scuttler can read the Focus database (Full Disk Access), or isn't
 * looking because Focus mode wallpaper is off (invariant 12). Mirrors
 * `FocusAccess` in appearance.rs. */
export type FocusAccess = 'granted' | 'denied' | 'off'

/** A Focus schedule window: minutes after local midnight, days 0 = Monday. */
export type FocusSchedule = { start: number; end: number; days: number[] }

/** Mirrors `FocusMode` in appearance.rs. */
export type FocusModeInfo = {
  id: string
  name: string
  /** Enabled time schedules, which scuttler evaluates itself. */
  schedules: FocusSchedule[]
  /** Turned on by Smart Activation, which no file records. */
  smart: boolean
}

/** Mirrors `AppearanceInputs` in appearance.rs. */
export type AppearanceInputs = {
  systemDark: boolean
  focusAccess: FocusAccess
  /** A Focus turned on by hand (or synced), if any; schedules are evaluated in
   * `lib/wallpaper.ts` (`activeFocus`). */
  assertedFocus: string | null
  /** When Focus was last turned off by hand, Unix seconds. */
  focusClearedAt: number | null
  /** Every configured Focus, empty unless access is granted. */
  modes: FocusModeInfo[]
}

export function appearanceInputs(): Promise<AppearanceInputs> {
  return invoke<AppearanceInputs>('appearance_inputs')
}

/**
 * The policy engine's runtime half, for the one window that lives all session
 * (the panel). Inputs arrive from Rust (`appearance-input`: macOS appearance or
 * the Focus changed); each time, resolve and — only if the answer differs —
 * write `config.theme`. Everything downstream (windows, borders, the
 * "everywhere" fan-out, the wallpaper) already follows a theme change, so this
 * hook has exactly one side effect.
 */
export function useAppearancePolicy(config: Config, loaded: boolean): void {
  const latest = useRef(config)
  latest.current = config
  const inputs = useRef<AppearanceInputs | null>(null)
  const settleRef = useRef<() => void>(() => {})
  // A policy edit in Settings (mode, pair) must take effect without waiting for
  // the next appearance change.
  const policyKey = JSON.stringify(config.appearance ?? null)
  useEffect(() => {
    if (loaded) settleRef.current()
  }, [loaded, policyKey])

  useEffect(() => {
    if (!loaded) return
    let disposed = false

    const settle = () => {
      const cfg = latest.current
      const seen = inputs.current
      if (!seen) return
      const pin: PolicyInputs = { systemDark: seen.systemDark }
      const res = policyResolution(cfg, pin)
      if (!res || res.theme === cfg.theme) return
      console.warn(
        `[scuttler appearance] ${cfg.theme} → ${res.theme} (${res.by})`,
      )
      updateConfig((c) => ({ ...c, theme: res.theme })).catch((e) =>
        console.error('[scuttler appearance] write failed:', e),
      )
    }

    settleRef.current = settle
    appearanceInputs()
      .then((i) => {
        if (disposed) return
        inputs.current = i
        settle()
      })
      .catch((e) => console.error('[scuttler appearance] inputs failed:', e))
    const un = listen<AppearanceInputs>('appearance-input', (e) => {
      inputs.current = e.payload
      settle()
    })
    // "Toggle Dark Mode" while the policy owns light/dark (Rust only emits this
    // when mode ≠ system; under system it flips the OS and we follow).
    const unToggle = listen('appearance-toggle', () => {
      const cfg = latest.current
      if (!policyConfigured(cfg)) return
      const policy = appearanceOf(cfg)
      const next = toggleMode(policy)
      if (next.mode === policy.mode) return
      updateConfig((c) => ({
        ...c,
        appearance: { ...appearanceOf(c), ...next },
      })).catch((e) => console.error('[scuttler appearance] toggle failed:', e))
    })
    return () => {
      disposed = true
      settleRef.current = () => {}
      un.then((f) => f())
      unToggle.then((f) => f())
    }
    // `config` is read through the ref: re-subscribing on every settings keystroke
    // would be waste. Policy edits re-settle through `policyKey` above.
  }, [loaded])
}
