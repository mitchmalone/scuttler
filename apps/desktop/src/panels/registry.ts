import { normalizeDesktop } from '@scuttlarr/core/desktop'
import {
  Bot,
  Camera,
  CircleHelp,
  ClipboardList,
  Coffee,
  Globe,
  LayoutGrid,
  type LucideIcon,
  Palette,
  Puzzle,
  Ship,
  Volume2,
  Wifi,
} from 'lucide-react'

import type { Config } from '../lib/config'

/**
 * Panel metadata is `@scuttlarr/core/panels` — one list for the app and the
 * site demo (invariant 10). This module adds what only the app knows: the icon
 * per panel and the settings gates. Adding a tenant: one entry in core + its
 * component in App.tsx.
 */
export {
  PANEL_INFO,
  PANEL_TRIGGERS,
  type PanelInfo,
} from '@scuttlarr/core/panels'

/** Lucide icon per panel — launcher rows and panel headers share it. */
export const PANEL_ICONS: Record<string, LucideIcon> = {
  agents: Bot,
  awake: Coffee,
  wifi: Wifi,
  dns: Globe,
  audio: Volume2,
  clipboard: ClipboardList,
  screenshots: Camera,
  help: CircleHelp,
  plugins: Puzzle,
  aerospace: LayoutGrid,
  theme: Palette,
  setup: Ship,
}

/** Panels gated by settings; anything unlisted is always on. */
export function panelEnabled(id: string, config: Config): boolean {
  if (id === 'agents') return config.agents.monitor
  if (id === 'aerospace') return normalizeDesktop(config.desktop).tiling.enabled
  return true
}
