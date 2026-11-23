import {
  Blocks,
  Bot,
  Focus,
  Image,
  Info,
  LayoutGrid,
  Link2,
  type LucideIcon,
  Palette,
  PanelTop,
  Pipette,
  Puzzle,
  RefreshCw,
  Rocket,
  Wrench,
} from 'lucide-react'

import type { PageId } from '../pages'

/** One lucide icon per page: the sidebar and the page header share it. */
export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  launcher: Rocket,
  bar: PanelTop,
  quicklinks: Link2,
  colorpicker: Pipette,
  theme: Palette,
  wallpaper: Image,
  focuswallpaper: Focus,
  desktop: LayoutGrid,
  machine: Wrench,
  agents: Bot,
  plugins: Puzzle,
  widgets: Blocks,
  updates: RefreshCw,
  about: Info,
}
