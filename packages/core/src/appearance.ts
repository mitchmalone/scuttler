/**
 * Theme policy (DECISIONS 2026-09-11, reshaped 2026-11-23): *which* theme is
 * active now. Pure — Rust reports whether macOS is dark and the panel window
 * resolves and writes `config.theme`. Omarchy has no such layer; a theme there
 * is picked by hand. Here a manual pick still wins until the next input change,
 * because a pick writes the pair's current-mode slot too.
 *
 * Three modes: `system` (Match System — the pair's light or dark half, following
 * macOS), `light` and `dark` (one theme, the pair's light or dark half, fixed).
 * 0.9 retired the `schedule` mode and per-Focus themes; old configs normalise
 * (`schedule` reads as `system`, `focus` is ignored).
 */

export type AppearanceMode = 'system' | 'light' | 'dark'

export type ThemePair = { light: string; dark: string }

export type AppearancePolicy = {
  mode: AppearanceMode
  pair: ThemePair
}

export const DEFAULT_POLICY: AppearancePolicy = {
  mode: 'dark',
  pair: { light: 'rose-pine-dawn', dark: 'scuttler' },
}

export type PolicyInputs = {
  /** macOS appearance right now. */
  systemDark: boolean
}

export type Resolution = {
  theme: string
  dark: boolean
  /** Which rule chose light vs dark. */
  by: AppearanceMode
}

/** A stored mode from any version: unknown or retired (`schedule`) → `system`. */
export function normalizeMode(mode: unknown): AppearanceMode {
  return mode === 'light' || mode === 'dark' ? mode : 'system'
}

export function isDark(
  policy: AppearancePolicy,
  inputs: PolicyInputs,
): boolean {
  switch (policy.mode) {
    case 'light':
      return false
    case 'dark':
      return true
    default:
      return inputs.systemDark
  }
}

export function resolveAppearance(
  policy: AppearancePolicy,
  inputs: PolicyInputs,
): Resolution {
  const dark = isDark(policy, inputs)
  return {
    theme: policy.pair[dark ? 'dark' : 'light'],
    dark,
    by: policy.mode,
  }
}

/** A manual pick sticks: write it into the slot the policy is currently reading. */
export function withPick(
  policy: AppearancePolicy,
  inputs: PolicyInputs,
  theme: string,
): AppearancePolicy {
  const res = resolveAppearance(policy, inputs)
  return withPickSlot(policy, theme, res.dark ? 'dark' : 'light')
}

/** Write a theme into one half — the reading one (`withPick`) or the other, so
 * you can choose tonight's dark theme while it is still light (⌥⏎). */
export function withPickSlot(
  policy: AppearancePolicy,
  theme: string,
  slot: 'light' | 'dark',
): AppearancePolicy {
  return { ...policy, pair: { ...policy.pair, [slot]: theme } }
}

/** "Toggle Dark Mode" while the policy owns light/dark: light ↔ dark. Under
 * `system` the caller flips the OS instead, and this returns the policy
 * unchanged. */
export function toggleMode(policy: AppearancePolicy): AppearancePolicy {
  if (policy.mode === 'system') return policy
  return { ...policy, mode: policy.mode === 'dark' ? 'light' : 'dark' }
}
