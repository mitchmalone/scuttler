import { describe, expect, it } from 'vitest'

import {
  pickHalf,
  pickTheme,
  pickThemeOther,
  policyInputs,
  setMode,
} from './appearance-ui'
import type { Config } from './config'

const DARK = { focusMode: null, systemDark: true, modes: [] } as never
const LIGHT = { focusMode: null, systemDark: false, modes: [] } as never

const config = (
  appearance?: Partial<Config['appearance']>,
  theme = 'scuttler',
): Config => ({ theme, themes: {}, appearance }) as unknown as Config

describe('policyInputs', () => {
  it('defaults missing inputs to light', () => {
    expect(policyInputs(null)).toEqual({ systemDark: false })
    expect(policyInputs(DARK)).toEqual({ systemDark: true })
  })
})

describe('pickTheme', () => {
  it('writes the theme and the pair slot the policy is reading', () => {
    const out = pickTheme(config(), DARK, 'dracula')
    expect(out.theme).toBe('dracula')
    // No policy yet: the pair was seeded from the current theme, the mode is that
    // theme's own (dark), and the pick fills the dark half.
    expect(out.appearance?.mode).toBe('dark')
    expect(out.appearance?.pair).toEqual({ light: 'scuttler', dark: 'dracula' })
    expect(out.appearance?.everywhere).toBe(false)
  })

  it('drops the keys 0.9 retired', () => {
    const out = pickTheme(
      config({
        mode: 'schedule' as never,
        schedule: { light: '07:00', dark: '19:00' },
        focus: { work: 'nord' },
      } as never),
      LIGHT,
      'flexoki-light',
    )
    expect(out.appearance?.mode).toBe('system')
    expect(out.appearance ?? {}).not.toHaveProperty('schedule')
    expect(out.appearance ?? {}).not.toHaveProperty('focus')
  })
})

describe('pickThemeOther', () => {
  it('sets the half the policy is not reading', () => {
    const out = pickThemeOther(
      config({ mode: 'system', pair: { light: 'a', dark: 'b' } }),
      DARK,
      'flexoki-light',
    )
    expect(out.appearance?.pair).toEqual({ light: 'flexoki-light', dark: 'b' })
  })
})

describe('setMode', () => {
  it('replaces a half holding the other mode’s theme, then follows the mode', () => {
    // Seeded: both halves are scuttler (dark). Light must not show a dark theme.
    const out = setMode(config(), DARK, 'light')
    expect(out.appearance?.mode).toBe('light')
    expect(out.appearance?.pair).toEqual({
      light: 'rose-pine-dawn',
      dark: 'scuttler',
    })
    expect(out.theme).toBe('rose-pine-dawn')
  })

  it('Match System shows the half macOS is in', () => {
    const c = config({
      mode: 'dark',
      pair: { light: 'solarized-light', dark: 'nord' },
    })
    expect(setMode(c, LIGHT, 'system').theme).toBe('solarized-light')
    expect(setMode(c, DARK, 'system').theme).toBe('nord')
  })
})

describe('pickHalf', () => {
  const c = config({ mode: 'system', pair: { light: 'a', dark: 'b' } })
  it('sets the named half; the theme follows only if it is showing', () => {
    expect(pickHalf(c, DARK, 'nord', 'dark')).toMatchObject({
      theme: 'nord',
      appearance: { pair: { light: 'a', dark: 'nord' } },
    })
    expect(pickHalf(c, DARK, 'flexoki-light', 'light')).toMatchObject({
      theme: 'b',
      appearance: { pair: { light: 'flexoki-light', dark: 'b' } },
    })
  })
})
