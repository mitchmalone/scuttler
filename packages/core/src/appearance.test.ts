import { describe, expect, it } from 'vitest'

import {
  type AppearancePolicy,
  DEFAULT_POLICY,
  isDark,
  normalizeMode,
  resolveAppearance,
  toggleMode,
  withPick,
  withPickSlot,
} from './appearance'

const policy = (p: Partial<AppearancePolicy> = {}): AppearancePolicy => ({
  ...DEFAULT_POLICY,
  pair: { light: 'solarized-light', dark: 'scuttler' },
  ...p,
})

describe('normalizeMode', () => {
  it('keeps the three modes and folds everything else into system', () => {
    expect(normalizeMode('light')).toBe('light')
    expect(normalizeMode('dark')).toBe('dark')
    expect(normalizeMode('system')).toBe('system')
    // 0.9 retired the schedule mode: old configs follow macOS instead.
    expect(normalizeMode('schedule')).toBe('system')
    expect(normalizeMode(undefined)).toBe('system')
    expect(normalizeMode(42)).toBe('system')
  })
})

describe('resolveAppearance', () => {
  it('Match System picks the half macOS is showing', () => {
    const p = policy({ mode: 'system' })
    expect(resolveAppearance(p, { systemDark: true })).toEqual({
      theme: 'scuttler',
      dark: true,
      by: 'system',
    })
    expect(resolveAppearance(p, { systemDark: false }).theme).toBe(
      'solarized-light',
    )
  })

  it('light and dark are one theme, whatever macOS shows', () => {
    expect(
      resolveAppearance(policy({ mode: 'light' }), { systemDark: true }).theme,
    ).toBe('solarized-light')
    expect(
      resolveAppearance(policy({ mode: 'dark' }), { systemDark: false }).theme,
    ).toBe('scuttler')
    expect(isDark(policy({ mode: 'dark' }), { systemDark: false })).toBe(true)
  })

  it('starts as a single dark theme', () => {
    expect(DEFAULT_POLICY.mode).toBe('dark')
  })
})

describe('withPick', () => {
  it('writes the pair slot the policy is reading right now', () => {
    const p = policy({ mode: 'system' })
    expect(withPick(p, { systemDark: true }, 'nord').pair).toEqual({
      light: 'solarized-light',
      dark: 'nord',
    })
    expect(withPick(p, { systemDark: false }, 'flexoki-light').pair).toEqual({
      light: 'flexoki-light',
      dark: 'scuttler',
    })
  })

  it('in a fixed mode writes that mode’s half', () => {
    expect(
      withPick(policy({ mode: 'light' }), { systemDark: true }, 'gruvbox-light')
        .pair.light,
    ).toBe('gruvbox-light')
  })
})

describe('withPickSlot', () => {
  it('writes the named half without touching the other', () => {
    expect(withPickSlot(policy(), 'catppuccin-latte', 'light').pair).toEqual({
      light: 'catppuccin-latte',
      dark: 'scuttler',
    })
  })
})

describe('toggleMode', () => {
  it('flips fixed modes and leaves Match System to macOS', () => {
    expect(toggleMode(policy({ mode: 'light' })).mode).toBe('dark')
    expect(toggleMode(policy({ mode: 'dark' })).mode).toBe('light')
    const sys = policy({ mode: 'system' })
    expect(toggleMode(sys)).toBe(sys)
  })
})
