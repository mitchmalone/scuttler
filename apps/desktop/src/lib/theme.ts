import {
  type PolicyInputs,
  type Resolution,
  normalizeMode,
  resolveAppearance,
} from '@scuttler/core/appearance'
import {
  BUILTIN_THEME_SOURCES,
  type RenderedTheme,
  TEMPLATES,
  renderTheme,
} from '@scuttler/theme'
import { isLightColor, resolveTheme } from '@scuttler/tui/themes'
import { invoke } from '@tauri-apps/api/core'

import {
  type AppearanceConfig,
  type Config,
  DEFAULT_APPEARANCE,
} from './config'
import { type UserTheme, userThemes } from './user-themes'

/**
 * The theme rung (DECISIONS 2026-09-11): render the active theme through the
 * package's templates and hand the bytes to Rust (`theme_apply`), which stages,
 * swaps `~/.local/state/scuttler/current/theme/`, and fans out reloads.
 * Rendering is pure and lives in `@scuttler/theme`; this file is the seam.
 */

/** Mirrors `ThemeResult` in theme.rs. */
export type ThemeResult = {
  path: string
  reloaded: string[]
  failed: [string, string][]
  /** Editors not installed or not running — nothing to do. */
  skipped: string[]
}

/** The pre-rename default theme name still found in configs (`resolveTheme` aliases it too). */
const ALIASES: Record<string, string> = { launcharr: 'scuttler' }

/** The keys that are the policy (`@scuttler/core/appearance`), as against the rung
 * flags stored beside them. */
const POLICY_KEYS = ['mode', 'pair'] as const

/** The engine only runs once the user has a policy on disk (the first-launch setup,
 * Settings → General ▸ Theme or `theme ⏎` write one). An upgrade or a fresh profile
 * must never restyle a machine by itself (JOURNAL 2026-09-11). The test is the
 * policy's own keys, not the `appearance` object: config.rs always serialises that
 * with its rung flags, so the object is never absent in the webview (JOURNAL
 * 2026-10-19). */
export function policyConfigured(config: Config): boolean {
  const a: Partial<AppearanceConfig> | undefined = config.appearance
  return a !== undefined && POLICY_KEYS.some((key) => a[key] !== undefined)
}

/** Merged with defaults. Until the user has a policy the pair is seeded with the
 * current theme on both halves and the mode is that theme's own (light or dark),
 * so turning the engine on changes nothing until a theme is actually chosen.
 * Keys 0.9 retired (`schedule`, `focus`) are dropped here, so the next write
 * removes them from config.json; a stored `schedule` mode reads as `system`. */
export function appearanceOf(config: Config): AppearanceConfig {
  const stored: Partial<AppearanceConfig> & Record<string, unknown> =
    config.appearance ?? {}
  const { schedule: _schedule, focus: _focus, ...a } = stored
  const configured = policyConfigured(config)
  const seeded = configured
    ? DEFAULT_APPEARANCE.pair
    : { light: config.theme, dark: config.theme }
  return {
    ...DEFAULT_APPEARANCE,
    ...a,
    mode: configured ? normalizeMode(a.mode) : themeMode(config),
    pair: { ...seeded, ...(a.pair ?? {}) },
  }
}

/** Whether the named theme is a light one, by its background. */
export function isLightTheme(
  name: string,
  themes: Config['themes'] | undefined,
): boolean {
  return isLightColor(resolveTheme(name, themes).bg)
}

/** The single mode a config without a policy is in: the current theme's own. */
function themeMode(config: Config): 'light' | 'dark' {
  return isLightTheme(config.theme, config.themes) ? 'light' : 'dark'
}

/** What the policy engine would set the theme to right now, or null while it's inert. */
export function policyResolution(
  config: Config,
  inputs: PolicyInputs,
): Resolution | null {
  if (!policyConfigured(config)) return null
  return resolveAppearance(appearanceOf(config), inputs)
}

/** Flip macOS with the theme only when *we* decide light/dark. In `system` mode the
 * OS is the source and flipping it back would loop. */
export function flipsMacos(config: Config): boolean {
  const a = appearanceOf(config)
  return a.macos && a.mode !== 'system'
}

/** Render the named theme: a user `colors.toml` (`~/.config/scuttler/themes/<name>/`,
 * hand files honoured) wins over a built-in of the same name. Token-only custom
 * themes (`config.themes`) have no palette to render surfaces from. */
export function renderNamed(
  themeName: string,
  user: UserTheme[] = [],
): RenderedTheme {
  const name = ALIASES[themeName] ?? themeName
  const mine = user.find((t) => t.name === name)
  if (mine) {
    return renderTheme({
      name,
      text: mine.text,
      templates: TEMPLATES,
      handFiles: mine.handFiles,
    })
  }
  const text = BUILTIN_THEME_SOURCES[name]
  if (!text) {
    throw new Error(
      `theme "${themeName}" has no colors.toml — only the app windows can wear it`,
    )
  }
  return renderTheme({ name, text, templates: TEMPLATES })
}

/** @deprecated alias kept for tests; built-ins only. */
export const renderBuiltin = (name: string) => renderNamed(name)

/** Apply `config.theme` everywhere the rung reaches. Fail-visible per surface. */
/** `withBackgrounds` false when Settings → Wallpaper (or a Focus) owns the
 * desktop picture: the theme's backgrounds must not cycle over it. */
export async function applyThemeEverywhere(
  config: Config,
  withBackgrounds = true,
): Promise<ThemeResult> {
  const user = await userThemes().catch(() => [] as UserTheme[])
  const rendered = renderNamed(config.theme, user)
  const backgrounds = withBackgrounds
    ? (user.find((t) => t.name === rendered.name)?.backgrounds ?? [])
    : []
  return invoke<ThemeResult>('theme_apply', {
    req: { ...themeApplyRequest(rendered, config), backgrounds },
  })
}

/** Mirrors `ThemeApply` in theme.rs. */
export type ThemeApply = {
  name: string
  mode: 'light' | 'dark'
  files: Record<string, string>
  osc: string
  /** Ask a running Ghostty to re-read its config (AppleScript, opt-in). */
  ghosttyReload: boolean
  appearance: boolean
  claude: string | null
  /** Absolute image paths the theme ships; Rust cycles through them. */
  backgrounds: string[]
  editors: boolean
  vscode: string | null
  zed: string | null
  btop: string | null
  neovimColorscheme: string | null
  helixTheme: string | null
}

/** Files that live outside the state dir go in their own slots; the rest is the
 * theme dir. The editor payloads ride along only when `appearance.editors` is on
 * (`neovim.lua` stays in the dir either way — it's a file to source, not a reload). */
export function themeApplyRequest(
  rendered: RenderedTheme,
  config: Config,
): ThemeApply {
  const {
    'claude.json': claude,
    'vscode-theme.json': vscode,
    'zed-theme.json': zed,
    'btop.theme': btop,
    ...files
  } = rendered.files
  const { editors, ghostty } = appearanceOf(config)
  return {
    name: rendered.name,
    mode: rendered.mode,
    files,
    osc: rendered.osc,
    ghosttyReload: ghostty,
    appearance: flipsMacos(config),
    claude: claude ?? null,
    backgrounds: [],
    editors,
    vscode: (editors && vscode) || null,
    zed: (editors && zed) || null,
    btop: (editors && btop) || null,
    neovimColorscheme: editors ? rendered.editors.neovim_colorscheme : null,
    helixTheme: editors ? rendered.editors.helix_theme : null,
  }
}

export function themeCurrent(): Promise<string | null> {
  return invoke<string | null>('theme_current')
}
