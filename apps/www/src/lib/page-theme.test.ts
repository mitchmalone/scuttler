import { BUILTIN_THEMES } from '@scuttler/tui/themes'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME,
  PREVIOUS_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  pageVars,
  themeBootScript,
  themeLabel,
  themeTokens,
} from './page-theme'

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i
const COLOR_KEYS = [
  '--bg',
  '--bg2',
  '--chip',
  '--border',
  '--hair',
  '--fg',
  '--body',
  '--muted',
  '--dim',
  '--dim2',
  '--accent',
  '--accent2',
  '--green',
  '--amber',
  '--danger',
  '--cta',
  '--cta-hover',
  '--cta-fg',
]

function runBoot(stored: string | null, previous: string | null = null) {
  const set: Record<string, string> = {}
  const root = {
    style: { setProperty: (k: string, v: string) => (set[k] = v) },
    dataset: {} as Record<string, string>,
  }
  new Function('localStorage', 'document', themeBootScript())(
    {
      getItem: (k: string) =>
        k === THEME_STORAGE_KEY
          ? stored
          : k === PREVIOUS_THEME_STORAGE_KEY
            ? previous
            : null,
    },
    { documentElement: root },
  )
  return { set, dataset: root.dataset }
}

describe('pageVars', () => {
  it.each(Object.keys(BUILTIN_THEMES))('maps %s to hex page tokens', (name) => {
    const v = pageVars(BUILTIN_THEMES[name]!)
    for (const k of COLOR_KEYS) expect(v[k], k).toMatch(HEX)
    expect(v['--cta']).toBe(BUILTIN_THEMES[name]!.accent)
    expect(v['--panel']).toBe(BUILTIN_THEMES[name]!.glass)
  })

  it('reads light or dark from the ground', () => {
    expect(pageVars(BUILTIN_THEMES['solarized-light']!)['color-scheme']).toBe(
      'light',
    )
    expect(pageVars(BUILTIN_THEMES.scuttler!)['color-scheme']).toBe('dark')
    expect(pageVars(BUILTIN_THEMES.scuttler!)['--logo']).toBe('invert(1)')
  })

  it('darkens fg only on light themes', () => {
    expect(pageVars(BUILTIN_THEMES.scuttler!)['--fg']).toBe(
      BUILTIN_THEMES.scuttler!.fg,
    )
    const sol = BUILTIN_THEMES['solarized-light']!
    expect(pageVars(sol)['--fg']).not.toBe(sol.fg)
  })

  it('falls back to the default for an unknown name', () => {
    expect(themeTokens('nope')).toBe(BUILTIN_THEMES[DEFAULT_THEME])
  })
})

describe('themeLabel', () => {
  it('title-cases slugs and keeps scuttler lowercase', () => {
    expect(themeLabel('tokyo-night')).toBe('Tokyo Night')
    expect(themeLabel('solarized-light')).toBe('Solarized Light')
    expect(themeLabel('nord')).toBe('Nord')
    expect(themeLabel('scuttler')).toBe('scuttler')
  })
})

describe('themeBootScript', () => {
  it('applies a stored theme before paint', () => {
    const { set, dataset } = runBoot('tokyo-night')
    expect(set).toEqual(pageVars(BUILTIN_THEMES['tokyo-night']!))
    expect(dataset.appTheme).toBe('tokyo-night')
  })

  it('falls back to the key written before the rename', () => {
    const { set, dataset } = runBoot(null, 'nord')
    expect(set).toEqual(pageVars(BUILTIN_THEMES.nord!))
    expect(dataset.appTheme).toBe('nord')
    // Today's key wins when both are set.
    expect(runBoot('dracula', 'nord').dataset.appTheme).toBe('dracula')
  })

  it('leaves the server-rendered default alone otherwise', () => {
    for (const stored of [null, 'not-a-theme']) {
      const { set, dataset } = runBoot(stored)
      expect(set).toEqual({})
      expect(dataset.appTheme).toBeUndefined()
    }
  })
})
