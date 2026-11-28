import { fuzzyMatch } from '@scuttler/core/matcher'

import type { SearchEntry } from './pages'

/**
 * Settings search: the launcher's own matcher (invariant 5) over row labels,
 * plus plain substring hits on each row's terms and hint. Labels are short, so
 * fuzziness helps there; terms and hints are prose, where a scattered
 * subsequence matches nearly anything — so they must contain the query.
 */

export type SearchHit = {
  entry: SearchEntry
  score: number
  /** Matched indices in the label, for highlighting; empty for a term hit. */
  positions: number[]
}

/** A term or hint hit ranks below any label hit of the same strength. */
const TERM_PENALTY = 40

export function searchSettings(
  query: string,
  index: readonly SearchEntry[],
  limit = 20,
): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const lower = q.toLowerCase()
  const hits: { hit: SearchHit; order: number }[] = []
  index.forEach((entry, order) => {
    const label = fuzzyMatch(q, entry.label)
    if (label) {
      hits.push({
        hit: { entry, score: label.score, positions: label.positions },
        order,
      })
      return
    }
    const prose = [...(entry.terms ?? []), entry.hint ?? '', entry.section]
    const best = prose
      .filter((t) => t.toLowerCase().includes(lower))
      .map((t) => fuzzyMatch(q, t)?.score ?? 0)
      .reduce<number | null>((a, s) => (a === null || s > a ? s : a), null)
    if (best !== null) {
      hits.push({
        hit: { entry, score: best - TERM_PENALTY, positions: [] },
        order,
      })
    }
  })
  return hits
    .sort((a, b) => b.hit.score - a.hit.score || a.order - b.order)
    .slice(0, limit)
    .map((h) => h.hit)
}

/** The DOM anchor for a row label — search lands on `[data-row=<anchor>]`. */
export function rowAnchor(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
