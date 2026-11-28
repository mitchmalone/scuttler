/**
 * The theme policy's UI half, shared by Settings → Theme and the `theme ⏎`
 * panel: turning Rust's inputs into `PolicyInputs` and a manual pick into a
 * config patch. Pure — the tauri calls stay in the callers.
 */
import {
  type AppearanceMode,
  type PolicyInputs,
  resolveAppearance,
  withPick,
  withPickSlot,
} from '@scuttler/core/appearance'

import type { Config } from './config'
import { appearanceOf, isLightTheme } from './theme'
import type { AppearanceInputs } from './use-appearance-policy'

/** Rust's inputs — what the policy resolves against. */
export function policyInputs(inputs: AppearanceInputs | null): PolicyInputs {
  return { systemDark: inputs?.systemDark ?? false }
}

/** ⌥⏎: set `theme` as the half the policy is *not* reading; the active theme
 * stays as it is. */
export function pickThemeOther(
  config: Config,
  inputs: AppearanceInputs | null,
  theme: string,
): Pick<Config, 'appearance'> {
  const appearance = appearanceOf(config)
  const other = resolveAppearance(appearance, policyInputs(inputs)).dark
    ? 'light'
    : 'dark'
  return {
    appearance: { ...appearance, ...withPickSlot(appearance, theme, other) },
  }
}

/** A manual pick: `config.theme` plus the policy slot it should stick in. */
export function pickTheme(
  config: Config,
  inputs: AppearanceInputs | null,
  theme: string,
): Pick<Config, 'theme' | 'appearance'> {
  const appearance = appearanceOf(config)
  return {
    theme,
    appearance: {
      ...appearance,
      ...withPick(appearance, policyInputs(inputs), theme),
    },
  }
}

/** Match System's two columns: set one half; the theme follows if that half is
 * the one showing now. */
export function pickHalf(
  config: Config,
  inputs: AppearanceInputs | null,
  theme: string,
  half: 'light' | 'dark',
): Pick<Config, 'theme' | 'appearance'> {
  const next = withPickSlot(appearanceOf(config), theme, half)
  const appearance = { ...appearanceOf(config), ...next }
  return {
    theme: resolveAppearance(appearance, policyInputs(inputs)).theme,
    appearance,
  }
}

/** The light half to fall back on when a half holds a theme of the wrong mode. */
export const FALLBACK_PAIR = { light: 'rose-pine-dawn', dark: 'scuttler' }

/**
 * Settings → Theme's mode switch. A half that holds a theme of the other mode
 * (the pair is seeded with the current theme on both halves) is replaced by the
 * fallback, so Light never shows a dark theme; then the theme follows the mode.
 */
export function setMode(
  config: Config,
  inputs: AppearanceInputs | null,
  mode: AppearanceMode,
): Pick<Config, 'theme' | 'appearance'> {
  const appearance = appearanceOf(config)
  const fits = (name: string, light: boolean) =>
    isLightTheme(name, config.themes) === light
  const pair = {
    light: fits(appearance.pair.light, true)
      ? appearance.pair.light
      : FALLBACK_PAIR.light,
    dark: fits(appearance.pair.dark, false)
      ? appearance.pair.dark
      : FALLBACK_PAIR.dark,
  }
  const next = { ...appearance, mode, pair }
  return {
    theme: resolveAppearance(next, policyInputs(inputs)).theme,
    appearance: next,
  }
}
