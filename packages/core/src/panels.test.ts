import { describe, expect, it } from 'vitest'

import { PANEL_INFO, PANEL_TRIGGERS } from './panels'

describe('PANEL_INFO', () => {
  it('has unique ids and a hint ending in the row arrow', () => {
    const ids = PANEL_INFO.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PANEL_INFO) expect(p.hint.endsWith(' ▸')).toBe(true)
  })

  it('maps every id and extra trigger word to its panel', () => {
    expect(PANEL_TRIGGERS.wifi).toBe('wifi')
    expect(PANEL_TRIGGERS.ss).toBe('screenshots')
    expect(PANEL_TRIGGERS.shots).toBe('screenshots')
    expect(Object.keys(PANEL_TRIGGERS)).toHaveLength(PANEL_INFO.length + 2)
  })
})
