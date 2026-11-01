import { isPluginModuleId, pluginModuleId } from '../plugins'
import type { BarModule, BarZones } from './types'

/**
 * The bar's default arrangement and the one normalization every renderer of
 * `bar.layout` applies — the app's bar and Settings, and the site demo, so a
 * fresh install and www.scuttler.app show the same strip (AGENTS invariant 10;
 * DECISIONS 2026-11-01). `config.rs` writes `DEFAULT_BAR_LAYOUT` into a fresh
 * config.json and a Rust test pins it equal to this list — change both.
 */

export type ZoneName = 'left' | 'center' | 'right'
export const ZONE_NAMES: ZoneName[] = ['left', 'center', 'right']

/** Every built-in module the bar knows (TS-only; Rust just stores zones). */
export const BAR_MODULE_IDS = [
  'workspaces',
  'agents',
  'frontApp',
  'clock',
  'wifi',
  'awake',
  'battery',
] as const

export const barModule = (id: string): BarModule => ({ id, enabled: true })

/** Default arrangement; also decides which zone a newly shipped module joins. */
export const DEFAULT_BAR_LAYOUT: BarZones = {
  left: ['workspaces', 'agents', 'frontApp'].map(barModule),
  center: [barModule('clock')],
  right: ['wifi', 'awake', 'plugin:usage', 'battery'].map(barModule),
}

/** Module ids that became plugins: an old layout keeps its place. */
const LEGACY_MODULE_IDS: Record<string, string> = { usage: 'plugin:usage' }

/** Layout id for a user widget (docs/WIDGETS.md): `widget:<id>`. */
export const widgetModuleId = (id: string) => `widget:${id}`
export const isWidgetModuleId = (id: string) => id.startsWith('widget:')

/** What normalization needs to know about a discovered widget or plugin:
 * its id, the zone its manifest asks for, and which of the two it is. */
export type WidgetHome = {
  id: string
  zone: string
  kind?: 'widget' | 'plugin'
}
const homeModuleId = (h: WidgetHome) =>
  h.kind === 'plugin' ? pluginModuleId(h.id) : widgetModuleId(h.id)

/** Same normalization everywhere (bar renderer + settings): drop unknown ids,
 * append known-but-missing ids enabled into their default zone (falling back
 * to right, where new status widgets belong). Widget ids (`widget:*`) are
 * kept wherever the layout has them — Settings may not know the live set —
 * and discovered widgets missing from the layout join their manifest zone. */
export function normalizeBarZones(
  zones: BarZones,
  widgets: WidgetHome[] = [],
): BarZones {
  const known = new Set<string>(BAR_MODULE_IDS)
  const seen = new Set<string>()
  const out: BarZones = { left: [], center: [], right: [] }
  for (const zone of ZONE_NAMES) {
    for (const raw of zones[zone]) {
      const m = LEGACY_MODULE_IDS[raw.id]
        ? { ...raw, id: LEGACY_MODULE_IDS[raw.id]! }
        : raw
      if (
        (known.has(m.id) || isWidgetModuleId(m.id) || isPluginModuleId(m.id)) &&
        !seen.has(m.id)
      ) {
        seen.add(m.id)
        out[zone].push(m)
      }
    }
  }
  for (const id of BAR_MODULE_IDS) {
    if (seen.has(id)) continue
    const home =
      ZONE_NAMES.find((z) => DEFAULT_BAR_LAYOUT[z].some((m) => m.id === id)) ??
      'right'
    out[home].push(barModule(id))
  }
  for (const w of widgets) {
    const id = homeModuleId(w)
    if (seen.has(id)) continue
    seen.add(id)
    const home = (ZONE_NAMES as string[]).includes(w.zone)
      ? (w.zone as ZoneName)
      : 'right'
    out[home].push(barModule(id))
  }
  return out
}

/** The arrangement a notched display uses: the explicit one when set, else
 * the main layout — normalized, then center folded into the head of the right
 * zone (a notched bar has no center; the camera housing owns it). */
export function notchedZones(
  bar: { layout: BarZones; notchedLayout?: BarZones | null } & Record<
    string,
    unknown
  >,
  widgets: WidgetHome[] = [],
): BarZones {
  const base = normalizeBarZones(bar.notchedLayout ?? bar.layout, widgets)
  return {
    left: base.left,
    center: [],
    right: [...base.center, ...base.right],
  }
}
