import type { BarWidget } from '@scuttler/tui'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'

import type { BarZones, ZoneName } from '../../lib/config'

const MODULE_LABELS: Record<string, string> = {
  workspaces: 'AeroSpace',
  agents: 'Agent monitors',
  frontApp: 'Active app',
  clock: 'Clock',
  wifi: 'Network',
  awake: 'Awake (keep-alive)',
  usage: 'Agent usage',
  battery: 'Battery',
}

/** Built-ins by name; a user widget (`widget:<id>`, docs/WIDGETS.md) shows
 * its manifest name when the live set knows it, else its id. */
const moduleLabel = (
  id: string,
  widgets: BarWidget[],
): { name: string; tag: string | null } => {
  const builtin = MODULE_LABELS[id]
  if (builtin) return { name: builtin, tag: null }
  if (id.startsWith('plugin:'))
    return { name: id.slice('plugin:'.length), tag: 'plugin' }
  if (!id.startsWith('widget:')) return { name: id, tag: null }
  const wid = id.slice('widget:'.length)
  const w = widgets.find((w) => w.id === wid)
  return { name: w?.name ?? wid, tag: 'widget' }
}

const ZONE_LABELS: Record<ZoneName, string> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
}

/**
 * One column per alignment zone plus a "Retired" tray. Modules drag between
 * and within columns; ✕ retires a widget to the tray, dragging it back into a
 * zone restores it. Retirement is `enabled: false` in place — the bar already
 * skips disabled modules, so no schema change. Pure HTML5 DnD: the list
 * reorders live as the drag passes over rows, commits through onChange.
 */
export function ZoneBoard({
  zones,
  zoneNames,
  widgets,
  onChange,
}: {
  zones: BarZones
  zoneNames: ZoneName[]
  /** The live user widgets, for labels. */
  widgets: BarWidget[]
  onChange: (next: BarZones) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)

  const all = () => [...zones.left, ...zones.center, ...zones.right]
  const retired = all().filter((m) => !m.enabled)
  const without = (id: string): BarZones => ({
    left: zones.left.filter((m) => m.id !== id),
    center: zones.center.filter((m) => m.id !== id),
    right: zones.right.filter((m) => m.id !== id),
  })
  /** Drop the dragged module into `zone`, before `beforeId` (or at the end);
   * dropping restores a retired widget. */
  const placeAt = (zone: ZoneName, beforeId: string | null) => {
    const moved = all().find((m) => m.id === dragId)
    if (!moved || moved.id === beforeId) return
    const next = without(moved.id)
    const list = next[zone]
    const at = beforeId ? list.findIndex((m) => m.id === beforeId) : -1
    list.splice(at < 0 ? list.length : at, 0, { ...moved, enabled: true })
    onChange(next)
  }
  const retire = (id: string) => {
    const flip = (list: BarZones['left']) =>
      list.map((x) => (x.id === id ? { ...x, enabled: false } : x))
    onChange({
      left: flip(zones.left),
      center: flip(zones.center),
      right: flip(zones.right),
    })
  }

  const chip = (
    m: { id: string; enabled: boolean },
    inZone: ZoneName | null,
  ) => {
    const label = moduleLabel(m.id, widgets)
    return (
      <div
        key={m.id}
        className={`modrow ${m.id === dragId ? 'modrow-dragging' : ''} ${inZone ? '' : 'modrow-retired'}`}
        draggable
        onDragStart={(e) => {
          setDragId(m.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnter={(e) => {
          if (inZone) {
            e.stopPropagation()
            placeAt(inZone, m.id)
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragEnd={() => setDragId(null)}
      >
        <GripVertical size={14} className="grip" aria-hidden />
        <span className="grow">{label.name}</span>
        {label.tag && <span className="chiptag">{label.tag}</span>}
        {inZone && (
          <button
            type="button"
            className="modx"
            title="retire widget"
            onClick={() => retire(m.id)}
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="zoneboard-wrap">
      <div
        className="zoneboard"
        style={{ gridTemplateColumns: `repeat(${zoneNames.length}, 1fr)` }}
      >
        {zoneNames.map((zone) => {
          const active = zones[zone].filter((m) => m.enabled)
          return (
            <div
              key={zone}
              className="zonecol"
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => {
                // Only when entering the column's empty space, not a row.
                if (e.target === e.currentTarget) placeAt(zone, null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragId(null)
              }}
            >
              <div className="zonehead">
                <span>{ZONE_LABELS[zone]}</span>
                <span>{active.length}</span>
              </div>
              {active.map((m) => chip(m, zone))}
              {active.length === 0 && (
                <div className="zoneempty">drop here</div>
              )}
            </div>
          )
        })}
      </div>
      <div
        className="zonetray"
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={() => {
          if (dragId) retire(dragId)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragId(null)
        }}
      >
        <div className="zonehead">Retired</div>
        <div className="zonetray-chips">
          {retired.map((m) => chip(m, null))}
          {retired.length === 0 && (
            <div className="zoneempty">✕ a widget, or drag it here</div>
          )}
        </div>
      </div>
    </div>
  )
}
