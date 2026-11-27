import type { WidgetServiceType } from '@scuttler/tui'

import type { WidgetService } from '../lib/config'

/**
 * The services a widget's user has added (Settings → Widgets → configure),
 * as pure edits over `config.widgetServices`. Rust delivers only complete
 * ones to the widget (widgets.rs `resolve_services`); these helpers keep the
 * list well-formed and say what each one still needs.
 */

export type ServiceMap = Record<string, WidgetService[]>

/** `dagu`, then `dagu-2`, `dagu-3`: unique within the widget, file-safe. */
export function nextServiceId(list: WidgetService[], type: string): string {
  const taken = new Set(list.map((s) => s.id))
  if (!taken.has(type)) return type
  let n = 2
  while (taken.has(`${type}-${n}`)) n++
  return `${type}-${n}`
}

/** "Dagu", then "Dagu 2": a header that tells two of a kind apart. */
export function nextServiceLabel(list: WidgetService[], name: string): string {
  const taken = new Set(list.map((s) => s.label))
  if (!taken.has(name)) return name
  let n = 2
  while (taken.has(`${name} ${n}`)) n++
  return `${name} ${n}`
}

/** Add one service of `type` at the end; returns the new map and its id. */
export function addService(
  all: ServiceMap | undefined,
  widget: string,
  type: WidgetServiceType,
): { map: ServiceMap; id: string } {
  const list = all?.[widget] ?? []
  const id = nextServiceId(list, type.type)
  const svc: WidgetService = {
    id,
    type: type.type,
    label: nextServiceLabel(list, type.name),
    values: {},
  }
  return { map: { ...all, [widget]: [...list, svc] }, id }
}

/** Change one service in place; an empty list drops the widget's key. */
export function updateService(
  all: ServiceMap | undefined,
  widget: string,
  id: string,
  change: (s: WidgetService) => WidgetService | null,
): ServiceMap {
  const list = (all?.[widget] ?? []).flatMap((s) =>
    s.id === id
      ? [change(s)].filter((x): x is WidgetService => x != null)
      : [s],
  )
  const next = { ...all }
  if (list.length) next[widget] = list
  else delete next[widget]
  return next
}

/** Set (or, empty, clear) one plain value. */
export function setServiceValue(
  all: ServiceMap | undefined,
  widget: string,
  id: string,
  key: string,
  value: string,
): ServiceMap {
  return updateService(all, widget, id, (s) => {
    const values = { ...s.values }
    if (value) values[key] = value
    else delete values[key]
    return { ...s, values }
  })
}

/** Required settings this service still lacks: plain values in config,
 * secrets by whether the Keychain holds them (`present`). */
export function serviceMissing(
  type: WidgetServiceType | undefined,
  svc: WidgetService,
  present: string[],
): string[] {
  if (!type) return []
  return type.settings
    .filter((s) => s.required)
    .filter((s) => (s.secret ? !present.includes(s.key) : !svc.values[s.key]))
    .map((s) => s.label || s.key)
}
