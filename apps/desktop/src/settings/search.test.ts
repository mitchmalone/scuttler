import { describe, expect, it } from 'vitest'

import {
  PAGES,
  SEARCH_INDEX,
  type SearchEntry,
  pageFromHash,
  rungState,
} from './pages'
import { rowAnchor, searchSettings } from './search'

const entry = (
  label: string,
  more: Partial<SearchEntry> = {},
): SearchEntry => ({
  page: 'launcher',
  section: 'S',
  label,
  ...more,
})

describe('searchSettings', () => {
  it('returns nothing for an empty or blank query', () => {
    expect(searchSettings('', SEARCH_INDEX)).toEqual([])
    expect(searchSettings('   ', SEARCH_INDEX)).toEqual([])
  })

  it('matches labels fuzzily and reports positions in the label', () => {
    const [hit] = searchSettings('hotk', [entry('Summon hotkey')])
    expect(hit?.entry.label).toBe('Summon hotkey')
    expect(hit?.positions).toEqual([7, 8, 9, 10])
  })

  it('finds a row by a term its label does not contain, with no label positions', () => {
    const [hit] = searchSettings('ghostty', [
      entry('Terminal', { terms: ['ghostty', 'iterm2'] }),
    ])
    expect(hit?.entry.label).toBe('Terminal')
    expect(hit?.positions).toEqual([])
  })

  it('does not match terms or hints as scattered subsequences', () => {
    // "gty" is a subsequence of "ghostty" but not a substring: label-only fuzziness.
    expect(
      searchSettings('gty', [entry('Terminal', { terms: ['ghostty'] })]),
    ).toEqual([])
  })

  it('matches hint text as a substring', () => {
    const [hit] = searchSettings('anywhere', [
      entry('Summon hotkey', { hint: 'Opens the prompt from anywhere.' }),
    ])
    expect(hit?.entry.label).toBe('Summon hotkey')
  })

  it('ranks a label match above a term-only match', () => {
    const hits = searchSettings('border', [
      entry('Gaps', { terms: ['border width'] }),
      entry('Draw a border around the focused window'),
    ])
    expect(hits.map((h) => h.entry.label)).toEqual([
      'Draw a border around the focused window',
      'Gaps',
    ])
  })

  it('keeps index order between equal scores', () => {
    const hits = searchSettings('x', [
      entry('a', { terms: ['x'] }),
      entry('b', { terms: ['x'] }),
    ])
    expect(hits.map((h) => h.entry.label)).toEqual(['a', 'b'])
  })

  it('caps the result count', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry(`row ${i}`))
    expect(searchSettings('row', many, 10)).toHaveLength(10)
  })

  it('finds Ghostty across pages in the real index', () => {
    const pages = new Set(
      searchSettings('ghostty', SEARCH_INDEX).map((h) => h.entry.page),
    )
    expect(pages).toEqual(new Set(['launcher', 'theme', 'machine']))
  })
})

describe('rowAnchor', () => {
  it('is stable, lowercase and punctuation-free', () => {
    expect(rowAnchor('Also reload Ghostty’s config')).toBe(
      'also-reload-ghostty-s-config',
    )
    expect(rowAnchor('  Summon hotkey ')).toBe('summon-hotkey')
  })
})

describe('the page registry', () => {
  it('has unique page ids', () => {
    const ids = PAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('indexes at least one row on every page', () => {
    for (const p of PAGES) {
      expect(SEARCH_INDEX.some((e) => e.page === p.id)).toBe(true)
    }
  })

  it('has no duplicate anchors within a page', () => {
    for (const p of PAGES) {
      const anchors = SEARCH_INDEX.filter((e) => e.page === p.id).map((e) =>
        rowAnchor(e.label),
      )
      expect(new Set(anchors).size).toBe(anchors.length)
    }
  })

  it('maps hashes, including pre-redesign tab ids', () => {
    expect(pageFromHash('#desktop')).toBe('desktop')
    expect(pageFromHash('desktop')).toBe('desktop')
    expect(pageFromHash('#general')).toBe('launcher')
    expect(pageFromHash('#menubar')).toBe('bar')
    expect(pageFromHash('#quicklinks')).toBe('quicklinks')
    expect(pageFromHash('#nope')).toBe('launcher')
    expect(pageFromHash('')).toBe('launcher')
  })

  it('reports rung state for the three rungs only', () => {
    const on = {
      appearance: { everywhere: true },
      desktop: { tiling: { enabled: true } },
      machine: { enabled: true },
    }
    expect(rungState('theme', on)).toBe('on')
    expect(rungState('desktop', on)).toBe('on')
    expect(rungState('machine', on)).toBe('on')
    expect(rungState('theme', {})).toBe('off')
    expect(rungState('machine', { machine: null })).toBe('off')
    expect(rungState('launcher', on)).toBeNull()
  })
})
