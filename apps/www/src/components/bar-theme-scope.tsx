'use client'

import { BUILTIN_THEMES, themeVars } from '@scuttlarr/tui/themes'

import { useAppTheme } from '@/lib/app-theme'

/**
 * Scopes the app's panel theme tokens to a subtree, in the theme the site picker
 * chose — so the bar still, the agent spotlight and the state legend retint with
 * the rest of the page (AGENTS invariant 8: the whole page wears one app theme).
 *
 * `@scuttlarr/tui/bar.css` styles against unprefixed `--bg` / `--fg` / `--dim`
 * / `--accent` / `--sigil` — in the app those are set on :root by `applyTheme`,
 * but on the website those same names are the *page* palette. Setting them here
 * hands the bar its own tokens without touching the rest of the page, using the
 * kit's own `themeVars`, so there's no second copy of the mapping.
 */
export function BarThemeScope({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const [themeName] = useAppTheme()
  const tokens = BUILTIN_THEMES[themeName] ?? BUILTIN_THEMES.scuttlarr!
  return (
    <div
      className={className}
      style={themeVars(tokens, 'panel') as React.CSSProperties}
    >
      {children}
    </div>
  )
}
