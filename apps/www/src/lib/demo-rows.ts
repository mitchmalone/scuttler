import { parseInput } from '@scuttler/core/grammar'
import {
  type Row,
  emojiRows,
  findQuicklink,
  launchRows,
  panelRows,
  quicklinkRows,
} from '@scuttler/core/rows'
import type { FrecencyMap, IndexItem } from '@scuttler/core/types'

import { PANEL_INFO } from './demo-data'
import { INDEX, QUICKLINKS, TRIGGERS } from './launch-index'

/**
 * Thin adapter between the real engine (@scuttler/core) and the demo. All
 * grammar, matching, ranking and row logic runs in core and the rows it returns
 * are the kit `Launcher`'s own input (invariant 10); this file only supplies the
 * fake index and reads an `enter` back into a toast line — no engine logic lives
 * on the website.
 */

/** Same shape the app ships as its default searchFallback. */
const SEARCH_FALLBACK = 'https://www.google.com/search?q={query}'

/** The mock index in the engine's shape; `path` is display-only fiction here. */
const CORE_INDEX: IndexItem[] = INDEX.map((item) => ({
  id: item.id,
  name: item.name,
  kind: item.kind,
  // Panel items carry their trigger word; for everything else `path` is display-only fiction.
  path: item.path ?? '',
  hint: item.hint,
  icon: item.icon ?? null,
  aliases: item.aliases,
}))

const KIND_BY_ID = new Map(INDEX.map((item) => [item.id, item.kind]))

const stripScheme = (url: string) => url.replace(/^https?:\/\//, '')

/** Human-readable toast line for what the app would do on Enter. */
export function actionFor(row: Row): string {
  const enter = row.enter
  switch (enter.kind) {
    case 'execute': {
      const verb = KIND_BY_ID.get(enter.id) === 'command' ? 'ran' : 'launched'
      return `${verb} ${row.title}`
    }
    case 'open-url':
      return `opened ${stripScheme(enter.url)}`
    case 'copy':
      return `copied ${enter.text}`
    case 'add-quicklink':
      return `drafted a quicklink for ${stripScheme(enter.url)}`
    case 'open-panel':
      return `opened the ${row.title} panel`
    default:
      return row.title
  }
}

/** The index item a row launches, for the demo's frecency bump; null otherwise. */
export const launchedId = (row: Row): string | null =>
  row.enter.kind === 'execute' ? row.enter.id : null

/** The panel a row opens inside the demo; null otherwise. */
export const openedPanel = (row: Row): string | null =>
  row.enter.kind === 'open-panel' ? row.enter.panel : null

export function computeDemoRows(raw: string, frecency: FrecencyMap): Row[] {
  const parsed = parseInput(raw, TRIGGERS)
  // The site demo has no terminal or claude CLI behind it.
  if (parsed.mode === 'bang' || parsed.mode === 'ask') return []
  if (parsed.mode === 'emoji') return emojiRows(parsed.query)
  if (parsed.mode === 'trigger') {
    const panel = PANEL_INFO.find((p) => p.id === parsed.trigger)
    if (panel) return panelRows(panel.id, panel.title, panel.hint)
    const link = findQuicklink(QUICKLINKS, parsed.trigger)
    if (!link) return []
    return quicklinkRows(link, parsed.args)
  }
  return launchRows(
    parsed.query,
    CORE_INDEX,
    frecency,
    SEARCH_FALLBACK,
    QUICKLINKS,
  )
}
