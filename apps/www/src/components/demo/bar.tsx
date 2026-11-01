'use client'

import UpdatesCell from '@scuttlarr/plugins/updates/cell'
import UsageCell from '@scuttlarr/plugins/usage/cell'
import {
  Bar,
  BarAgents,
  BarAwakeCell,
  BarBatteryCell,
  BarClock,
  BarFrontApp,
  BarWifiCell,
  BarWorkspaces,
  formatBarClock,
} from '@scuttlarr/tui'
import type { BarModule, BarZones } from '@scuttlarr/tui'
import {
  DEFAULT_BAR_LAYOUT,
  normalizeBarZones,
} from '@scuttlarr/tui/bar/layout'
import {
  NOOP_HOST,
  type PluginCellComponent,
  pluginIdOf,
} from '@scuttlarr/tui/plugins'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { WIFI, demoSnapshot } from '@/lib/demo-data'

import { useWebBarHover } from './bar-hover'

/** Each first-party plugin's own `cell.tsx`, keyed by id (invariant 10). */
const PLUGIN_CELLS: Record<string, PluginCellComponent<never>> = {
  usage: UsageCell as PluginCellComponent<never>,
  updates: UpdatesCell as PluginCellComponent<never>,
}

/** What a fresh install's bar shows: the default layout, normalized the way the
 * app normalizes it, with the bundled plugins that own a cell joining their
 * manifest zone — one arrangement, imported, not retyped (invariant 10). */
const LAYOUT: BarZones = normalizeBarZones(
  DEFAULT_BAR_LAYOUT,
  Object.keys(PLUGIN_CELLS).map((id) => ({
    id,
    zone: 'right',
    kind: 'plugin',
  })),
)

/**
 * The bar — the *actual* components from `@scuttlarr/tui`, the same ones the
 * desktop app renders, arranged by the same default layout. Live across the top
 * of the demo desktop (a ticking clock, switchable workspaces) or frozen at a
 * fixed instant as a still for the explainer section. The website supplies a
 * fictional snapshot and its own hover feed; it owns no bar markup or CSS.
 */
export function DemoBar({
  live = false,
  workspace = '2',
  onWorkspace,
  at,
  className,
}: {
  live?: boolean
  workspace?: string
  onWorkspace?: (ws: string) => void
  /** The still's instant; ignored when live. */
  at?: Date
  className?: string
}) {
  // Client-only clock: a build-time one would ship stale into static HTML and
  // hydrate-mismatch. The real bar gets `now` from Rust's 1 Hz push.
  const [tick, setTick] = useState<Date | null>(null)
  useEffect(() => {
    if (!live) return
    setTick(new Date())
    const id = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(id)
  }, [live])
  const now = live ? tick : (at ?? null)
  const nowOrEpoch = now ?? new Date(0)

  const hover = useWebBarHover()
  const snap = useMemo(
    () => demoSnapshot(Math.floor((now?.getTime() ?? 0) / 1000), workspace),
    [now, workspace],
  )

  const cell = (m: BarModule): ReactNode => {
    if (!m.enabled) return null
    switch (m.id) {
      case 'workspaces':
        return (
          <BarWorkspaces
            key={m.id}
            workspaces={snap.workspaces}
            focused={snap.focused}
            onSwitch={onWorkspace ?? (() => {})}
          />
        )
      case 'agents':
        return (
          <BarAgents
            key={m.id}
            agents={snap.agents}
            now={nowOrEpoch}
            hover={hover}
          />
        )
      case 'frontApp':
        return snap.frontApp ? (
          <BarFrontApp key={m.id} name={snap.frontApp} />
        ) : null
      case 'clock':
        return now ? (
          <BarClock key={m.id}>{formatBarClock(now)}</BarClock>
        ) : null
      case 'wifi':
        return (
          <BarWifiCell
            key={m.id}
            online={snap.wifi.online}
            ssid={snap.wifi.ssid}
            rssi={snap.wifi.rssi}
            hover={hover}
            // The card is the shipping component; only the addresses are fake.
            detail={{
              iface: WIFI.status.iface,
              online: snap.wifi.online,
              ssid: snap.wifi.ssid,
              ip: WIFI.status.ip,
              router: WIFI.status.router,
              dns: WIFI.status.dns,
            }}
          />
        )
      case 'awake':
        // No hold armed on the demo Mac: the dim cup a fresh install shows.
        return <BarAwakeCell key={m.id} armed={false} hover={hover} />
      case 'battery':
        return (
          <BarBatteryCell
            key={m.id}
            pct={snap.batteryPct}
            onAc={snap.onAc}
            charging={snap.charging}
            chargeLimit={snap.chargeLimit}
            // No ioreg in a browser: the strip is real, the card needs a machine.
            detail={null}
            hover={hover}
          />
        )
      default: {
        // Each plugin cell is the first-party plugin's own `cell.tsx`, over
        // the snapshot's plugin state — the demo runs plugins too.
        const pluginId = pluginIdOf(m.id)
        const Cell = pluginId ? PLUGIN_CELLS[pluginId] : undefined
        const state = snap.plugins?.find((p) => p.id === pluginId)
        if (!Cell || !state) return null
        return (
          <Cell
            key={m.id}
            plugin={state}
            state={state.state as never}
            settings={{}}
            now={nowOrEpoch}
            hover={hover}
            host={NOOP_HOST}
          />
        )
      }
    }
  }

  return (
    <div className={className}>
      <Bar
        left={LAYOUT.left.map(cell)}
        center={LAYOUT.center.map(cell)}
        right={LAYOUT.right.map(cell)}
      />
    </div>
  )
}
