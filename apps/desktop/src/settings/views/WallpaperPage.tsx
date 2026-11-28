import { isLightColor, resolveTheme } from '@scuttler/tui/themes'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

import type { WallpaperConfig } from '../../lib/config'
import { appearanceOf } from '../../lib/theme'
import { useMergedThemes } from '../../lib/user-themes'
import { wallpaperOf } from '../../lib/wallpaper'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Row, Section, Toggle } from '../ui'
import { Thumb } from './Thumb'
import { PAGE_ICONS } from './icons'

/**
 * Settings → Wallpaper (DECISIONS 2026-11-23): the default desktop picture, a
 * light image and a dark image swapped with the theme. A half with no image
 * leaves it to the theme's own backgrounds. Focus overrides live on their own
 * page; this one is only the default.
 */
export function WallpaperPage({ config, set }: PageProps) {
  const def = pageDef('wallpaper')
  const w = wallpaperOf(config)
  const merged = useMergedThemes(config)
  const [error, setError] = useState<string | null>(null)
  const setWallpaper = (p: Partial<WallpaperConfig>) =>
    set('wallpaper', { ...w, ...p })
  const pick = (half: 'light' | 'dark') => {
    setError(null)
    invoke<string | null>('wallpaper_pick')
      .then((path) => path && setWallpaper({ [half]: path }))
      .catch((e) => setError(String(e)))
  }
  const mode = appearanceOf(config).mode
  const themeLight = isLightColor(resolveTheme(config.theme, merged).bg)
  const usedWhen = (half: 'light' | 'dark') => {
    if (half === (themeLight ? 'light' : 'dark')) return 'in use now'
    if (mode === 'system') return `used while the theme is ${half}`
    return `used if the theme is ${half}`
  }

  const well = (half: 'light' | 'dark') => (
    <div className="well">
      <div className="well-head">
        <span>{half === 'light' ? 'Light' : 'Dark'}</span>
        <span className="dimtext">{usedWhen(half)}</span>
      </div>
      <Thumb
        path={w[half]}
        empty="the theme's own backgrounds"
        className={half}
      />
      <div className="btnrow">
        <button type="button" className="btn" onClick={() => pick(half)}>
          choose…
        </button>
        {w[half] && (
          <button
            type="button"
            className="btn dim"
            onClick={() => setWallpaper({ [half]: null })}
          >
            use the theme&apos;s
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Page
      icon={PAGE_ICONS.wallpaper}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
    >
      <Section>
        <Row
          label="Let scuttler set the wallpaper"
          cfg="enabled"
          hint="Off leaves macOS's wallpaper alone."
        >
          <Toggle
            label="Let scuttler set the wallpaper"
            checked={w.enabled}
            onChange={(on) => setWallpaper({ enabled: on })}
          />
        </Row>
      </Section>

      <Section title="Images">
        <Block anchor="Light and dark images">
          <div className={`wells${w.enabled ? '' : ' muted'}`}>
            {well('light')}
            {well('dark')}
          </div>
          {error && <Note tone="error">{error}</Note>}
        </Block>
      </Section>

      <Section title="Where">
        <Row
          label="Every display"
          hint={
            <>
              The current Space on each display: macOS gives apps no way to
              reach the others. Turn on &ldquo;Show on all Spaces&rdquo; in
              System Settings › Wallpaper once and it covers the rest.
            </>
          }
        />
      </Section>
    </Page>
  )
}
