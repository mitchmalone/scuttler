import {
  type AppearancePolicy,
  DEFAULT_POLICY,
} from '@scuttler/core/appearance'
import type { DesktopConfig } from '@scuttler/core/desktop'
import type { Link } from '@scuttler/core/types'
import type { BarZones } from '@scuttler/tui'

import type { ThemeTokens } from './themes'

/**
 * App configuration. Desktop-only: it references ThemeTokens and app concerns (hotkey,
 * terminal hand-off), so it lives beside the app rather than in @scuttler/core.
 */
export type Config = {
  /** Defaults generation (config.rs `DEFAULTS_VERSION`); Rust owns it, a write without
   * it takes the current one. */
  defaultsVersion?: number
  /** First-launch setup still owed (config.rs: only a freshly created file says true). */
  setupPending?: boolean
  hotkey: string
  terminal: 'Ghostty' | 'iTerm2' | 'Terminal'
  bangNewWindow: boolean
  sigil: string
  bangSigil: string
  launchAtLogin: boolean
  links: Link[]
  shortcuts: Record<string, string>
  /** Alfred-style dead-end fallback, {query} placeholder. */
  searchFallback: string
  indexBookmarks: boolean
  /** Active theme name: built-in (scuttler, dracula, terminal) or a `themes` key. */
  theme: string
  /** User-defined themes: name → partial token overrides (see lib/themes.ts). */
  themes: Record<string, Partial<ThemeTokens>>
  /** The menubar-replacement bar (v0.5). `enabled` hot-applies. */
  bar: BarConfig
  /** Agent monitoring + usage monitor; all off by default. */
  agents: AgentsConfig
  /** The desktop layer (v0.4): AeroSpace tiling, JankyBorders, corner radius. Rust
   * persists it opaquely; read it through `normalizeDesktop` (partial/absent → defaults). */
  desktop: Partial<DesktopConfig> | undefined
  /** The machine rung (Settings → Machine): setup CLI on PATH, migrations at launch. */
  machine: MachineConfig | undefined
  /** The theme rung: render the theme beyond the app (Ghostty, tmux, prompt, delta,
   * Claude Code) and follow it with macOS light/dark. */
  appearance: AppearanceConfig | undefined
  /** `colorpicker` opens the scuttler loupe (2×) — needs Screen Recording, so it is
   * opt-in and the toggle is what triggers the prompt; off = Apple's sampler. */
  colorLoupe: boolean
  /** Loupe magnification, 2–8 (default 8). */
  colorLoupeZoom: number
  /** Loupe diameter in points (default 264). */
  colorLoupeSize: number
  /** Plain widget/plugin settings: id → KEY → value (manifest `settings`,
   * docs/WIDGETS.md, docs/PLUGINS.md). Secrets are Keychain-only and never
   * appear here. */
  widgets: Record<string, Record<string, string>>
  /** Plugins (docs/PLUGINS.md): which are switched off. */
  plugins: { disabled: string[] }
  /** scuttler's own updates: check GitHub Releases and offer the newest in `updates ⏎`. */
  updates: UpdatesConfig | undefined
}

export type UpdatesConfig = { checkSelf: boolean }

export type MachineConfig = { enabled: boolean }

/** `everywhere`/`macos` are the rung; the rest is the policy
 * (`@scuttler/core/appearance`), stored flat in the same object. */
export type AppearanceConfig = {
  everywhere: boolean
  macos: boolean
  /** Hot editors: VS Code/Cursor, Zed, Neovim, Helix, btop retint at theme set. */
  editors: boolean
  /** Reload a running Ghostty's config over AppleScript (one Automation consent). */
  ghostty: boolean
} & AppearancePolicy
export const DEFAULT_APPEARANCE: AppearanceConfig = {
  everywhere: false,
  macos: true,
  editors: false,
  ghostty: false,
  ...DEFAULT_POLICY,
}

export type BarConfig = {
  enabled: boolean
  /** Alignment zones (mirrors BarZones in config.rs): every module lives in
   * left, center, or right, ordered within its zone. Clock is ordinary. */
  layout: BarZones
  /** Notched displays: left/right only (the camera housing owns the center);
   * absent → derived from `layout` via `notchedZones`. */
  notchedLayout?: BarZones | null
}

/* Shape and default arrangement live in the kit — the bar renders from them in
 * both the app and on www.scuttler.app, so there is one definition and one
 * normalization (invariant 10; DECISIONS 2026-11-01). Re-exported here so the
 * app's config consumers keep one import. */
export type { BarModule, BarZones } from '@scuttler/tui'
export {
  BAR_MODULE_IDS,
  DEFAULT_BAR_LAYOUT,
  type WidgetHome,
  ZONE_NAMES,
  type ZoneName,
  isWidgetModuleId,
  normalizeBarZones,
  notchedZones,
  widgetModuleId,
} from '@scuttler/tui/bar/layout'

/** Layout id for a plugin's cell (docs/PLUGINS.md): `plugin:<id>`. */
export {
  isPluginModuleId,
  pluginIdOf,
  pluginModuleId,
} from '@scuttler/tui/plugins'

export type AgentsConfig = {
  /** Local agent session monitoring (socket, bar cells, `agents ⏎`). */
  monitor: boolean
  /** Show idle sessions in the bar; active states always show. */
  showIdle: boolean
  /** Sessions silent this long are pruned. */
  pruneHours: number
  /** The `usage ⏎` token monitor. */
  usage: boolean
  /** Agent mode: `?` converses with the user's own agent CLI. */
  askMode: boolean
  /** Which CLI answers `?`. */
  askProvider: 'claude' | 'codex'
  /** Consent capabilities: scuttler may read the CLI's stored credentials
   * for account-limit fetches; the code owns source selection + fallback. */
  claudeCreds: boolean
  codexCreds: boolean
  /** Overrides for discovered Claude accounts (`~/.claude`, `~/.claude-*`):
   * rename or hide one. Discovery itself needs no config. */
  claudeAccounts: ClaudeAccountConfig[]
}

/** One `agents.claudeAccounts` entry, keyed by config dir (`~/` allowed). */
export type ClaudeAccountConfig = {
  dir: string
  label: string | null
  enabled: boolean
}

export const DEFAULT_AGENTS_CONFIG: AgentsConfig = {
  monitor: false,
  showIdle: true,
  pruneHours: 12,
  usage: false,
  askMode: false,
  askProvider: 'claude',
  claudeCreds: false,
  codexCreds: false,
  claudeAccounts: [],
}
