/**
 * Render one theme into every surface: tokens for the app, one file per template,
 * and the OSC payload. Pure — the caller supplies texts and writes the results.
 */
import { isHex6 } from './color.ts'
import { type EditorThemes, editorThemesFor } from './editors.ts'
import { oscSequences } from './osc.ts'
import {
  PaletteError,
  type ResolvedPalette,
  parseThemeFile,
  resolve,
} from './palette.ts'
import { TemplateError, render } from './template.ts'
import type { ThemeTokens } from './theme-tokens.ts'
import { toTokens } from './tokens.ts'

export type RenderInput = {
  name: string
  /** The theme's `colors.toml`. */
  text: string
  /** Template file name (`ghostty.tpl`) → template text. */
  templates: Record<string, string>
  /** Hand-written files shipped in the theme dir, output name → text; they win. */
  handFiles?: Record<string, string>
}

export type RenderedTheme = {
  name: string
  mode: 'light' | 'dark'
  tokens: ThemeTokens
  /** Output file name (template key without `.tpl`) → rendered text. */
  files: Record<string, string>
  osc: string
  /** Names for editors that pick a theme by name (`editors.ts`); also template keys. */
  editors: EditorThemes
}

/**
 * bat/delta syntax theme. `ansi` is bat's built-in that paints with the terminal's own
 * 16 colours, so it follows the palette in both modes with no per-theme mapping; a
 * theme can name a specific bat theme with a top-level `bat_theme` in colors.toml.
 */
export const DEFAULT_BAT_THEME = 'ansi'

/**
 * Keys whose value is a name, not a colour. Everything else in the palette must be
 * `#rrggbb`. Names are letters, digits, space, `_`, `.`, `-`, `(`, `)`: enough for
 * "Solarized (dark)" or `catppuccin_mocha`, and nothing a zsh single-quoted string, a
 * gitconfig value or a Lua double-quoted string could read as syntax.
 */
const NAME_KEYS: ReadonlySet<string> = new Set([
  'name',
  'mode',
  'theme_type',
  'bat_theme',
  'vscode_theme',
  'neovim_colorscheme',
  'helix_theme',
])
const NAME_PATTERN = /^[A-Za-z0-9 _.()-]{1,64}$/

/**
 * A theme is data: refuse anything a template could carry into a file that zsh
 * sources, git includes or Neovim loads (DECISIONS 2026-11-08). Every key reaches
 * `render()` by raw substitution, so the check is on the whole extended palette,
 * unknown root keys included.
 */
export function validatePalette(palette: Record<string, string>): void {
  for (const [key, value] of Object.entries(palette)) {
    if (NAME_KEYS.has(key)) {
      if (!NAME_PATTERN.test(value)) {
        throw new PaletteError(
          `${key} must be a plain name (letters, digits, space, _ . - parentheses), got ${JSON.stringify(value)}`,
        )
      }
    } else if (!isHex6(value)) {
      throw new PaletteError(
        `${key} must be a colour (#rrggbb), got ${JSON.stringify(value)}`,
      )
    }
  }
}

export function renderTheme(input: RenderInput): RenderedTheme {
  const { palette: raw, launcher } = parseThemeFile(input.text)
  const resolved = resolve(raw)
  const editors = editorThemesFor(input.name, resolved)
  const extended: ResolvedPalette = {
    ...resolved,
    name: input.name,
    bat_theme: resolved.bat_theme || DEFAULT_BAT_THEME,
    ...editors,
  }
  validatePalette(extended)

  const files: Record<string, string> = {}
  for (const [key, template] of Object.entries(input.templates)) {
    if (!key.endsWith('.tpl'))
      throw new TemplateError(`template ${key}: name must end in .tpl`)
    const out = key.slice(0, -'.tpl'.length)
    try {
      files[out] = render(template, extended)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new TemplateError(`template ${key}: ${reason}`, { cause: error })
    }
  }
  for (const [out, text] of Object.entries(input.handFiles ?? {}))
    files[out] = text

  return {
    name: input.name,
    mode: extended.mode,
    tokens: toTokens(resolved, launcher),
    files,
    osc: oscSequences(resolved),
    editors,
  }
}
