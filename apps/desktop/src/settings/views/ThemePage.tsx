import {
  type AppearanceMode,
  resolveAppearance,
} from '@scuttler/core/appearance'
import {
  type ThemeTokens,
  isLightColor,
  resolveTheme,
} from '@scuttler/tui/themes'
import { useState } from 'react'

import {
  pickHalf,
  pickTheme,
  policyInputs,
  setMode,
} from '../../lib/appearance-ui'
import type { AppearanceConfig } from '../../lib/config'
import {
  type ThemeResult,
  appearanceOf,
  applyThemeEverywhere,
} from '../../lib/theme'
import { BUILTIN_THEMES, themeNames } from '../../lib/themes'
import {
  installTheme,
  removeTheme,
  updateThemes,
  useMergedThemes,
  useUserThemes,
} from '../../lib/user-themes'
import { wallpaperOf } from '../../lib/wallpaper'
import { pageDef, rungState } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Row, Section, Segmented, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'
import { useAppearanceInputs } from './use-inputs'

const MODES: { id: AppearanceMode; label: string; hint: string }[] = [
  {
    id: 'system',
    label: 'Match System',
    hint: 'A light theme and a dark theme that swap with macOS, including its sunrise and sunset schedule.',
  },
  { id: 'light', label: 'Light', hint: 'One theme, always light.' },
  { id: 'dark', label: 'Dark', hint: 'One theme, always dark.' },
]

/**
 * Settings → Theme (the Theme rung, DECISIONS 2026-09-11, reshaped 2026-11-23):
 * Match System, Light or Dark. A single mode is one gallery and one pick; Match
 * System is a light column and a dark column, one pick in each. Then the rung
 * itself — rendering the theme beyond the app.
 */
export function ThemePage({ config, set, patch }: PageProps) {
  const def = pageDef('theme')
  const appearance = appearanceOf(config)
  const merged = useMergedThemes(config)
  const names = themeNames(merged)
  const tokens = (name: string) => resolveTheme(name, merged)
  const light = names.filter((n) => isLightColor(tokens(n).bg))
  const dark = names.filter((n) => !isLightColor(tokens(n).bg))
  const user = useUserThemes()
  const { inputs } = useAppearanceInputs()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ThemeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setAppearance = (p: Partial<AppearanceConfig>) =>
    set('appearance', { ...appearance, ...p })
  const applyNow = () => {
    setBusy(true)
    setError(null)
    // Settings can't see the active Focus; the static rule is enough here.
    const w = wallpaperOf(config)
    const half = isLightColor(tokens(config.theme).bg) ? 'light' : 'dark'
    applyThemeEverywhere(config, !(w.enabled && w[half]))
      .then(setResult)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }
  const mode = appearance.mode
  const showingDark = resolveAppearance(appearance, policyInputs(inputs)).dark
  const builtins = names.filter((n) => BUILTIN_THEMES[n]).length
  const rung = rungState('theme', config)
  const gallery = (list: string[], half: 'light' | 'dark' | null) => (
    <div className="gallery">
      {list.map((name) => {
        const chosen = half
          ? appearance.pair[half] === name
          : name === config.theme
        const now = half !== null && chosen && showingDark === (half === 'dark')
        return (
          <ThemeCard
            key={name}
            name={name}
            tokens={tokens(name)}
            current={chosen}
            tag={
              chosen ? (half ? (now ? `${half} · now` : half) : 'in use') : null
            }
            onPick={() =>
              patch(
                half
                  ? pickHalf(config, inputs, name, half)
                  : pickTheme(config, inputs, name),
              )
            }
          />
        )
      })}
    </div>
  )

  return (
    <Page
      icon={PAGE_ICONS.theme}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
      aside={<span className={`pill ${rung}`}>rung {rung}</span>}
    >
      <Section>
        <Row
          label="Appearance"
          cfg="appearance.mode"
          hint={MODES.find((m) => m.id === mode)?.hint}
        >
          <Segmented
            options={MODES}
            value={mode}
            onChange={(m) => patch(setMode(config, inputs, m))}
          />
        </Row>
      </Section>

      {mode === 'system' ? (
        <Section
          title="Themes"
          aside={`${builtins} built in · ${user.length} yours`}
        >
          <Block anchor="Themes">
            <div className="halves">
              <div>
                <div className="halfhead">
                  <i className="modedot light" />
                  Light<span className="dimtext">{light.length}</span>
                </div>
                {gallery(light, 'light')}
              </div>
              <div>
                <div className="halfhead">
                  <i className="modedot dark" />
                  Dark<span className="dimtext">{dark.length}</span>
                </div>
                {gallery(dark, 'dark')}
              </div>
            </div>
          </Block>
          <UserThemes />
        </Section>
      ) : (
        <Section
          title={mode === 'light' ? 'Light themes' : 'Dark themes'}
          aside={`${(mode === 'light' ? light : dark).length}`}
        >
          <Block anchor="Themes">
            {gallery(mode === 'light' ? light : dark, null)}
          </Block>
          <UserThemes />
        </Section>
      )}

      <Section title="Everywhere">
        <Row
          label="Render this theme into Ghostty, tmux, the prompt, delta and Claude Code"
          cfg="appearance.everywhere"
          hint={
            <>
              The Theme rung. Files land in{' '}
              <code>~/.local/state/scuttler/current/theme/</code>; every open
              shell retints at once (tmux or not, any terminal, no permission),
              new terminal windows read the files. Themes you add in config.json
              are token-only and stay app-only.
            </>
          }
        >
          <Toggle
            label="Render this theme everywhere"
            checked={appearance.everywhere}
            onChange={(on) => {
              setAppearance({ everywhere: on })
              if (on) applyNow()
            }}
          />
        </Row>
        <Row
          label="Also reload Ghostty’s config"
          cfg="appearance.ghostty"
          hint="The retint above changes colours only; this asks a running Ghostty to re-read its config so open windows take the whole theme. One Automation prompt, the first time. Needs Ghostty 1.3+."
        >
          <Toggle
            label="Also reload Ghostty’s config"
            checked={appearance.ghostty}
            onChange={(on) => setAppearance({ ghostty: on })}
          />
        </Row>
        <Row
          label="Follow it with macOS light/dark"
          cfg="appearance.macos"
          hint="Only in Light or Dark: under Match System macOS is the source and scuttler follows it, not the other way round."
        >
          <Toggle
            label="Follow it with macOS light/dark"
            checked={appearance.macos}
            onChange={(on) => setAppearance({ macos: on })}
          />
        </Row>
        <Row
          label="Also retint editors"
          cfg="appearance.editors"
          hint={
            <>
              VS Code, Cursor, Zed, Neovim, Helix, btop. Installs a generated
              theme for each and switches to it in their own settings files (a
              one-time <code>.bak-scuttler</code> beside each). Running
              instances change on the spot; ones not installed are skipped.
            </>
          }
        >
          <Toggle
            label="Also retint editors"
            checked={appearance.editors}
            onChange={(on) => setAppearance({ editors: on })}
          />
        </Row>
        <Block>
          <div className="btnrow">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={applyNow}
            >
              {busy ? 'applying…' : 'apply now'}
            </button>
            {result && (
              <span className="dimtext">
                {result.reloaded.length > 0 &&
                  `reloaded: ${result.reloaded.join(', ')}`}
                {result.failed.length > 0 &&
                  ` · failed: ${result.failed.map(([w, why]) => `${w} (${why})`).join('; ')}`}
                {result.reloaded.length === 0 &&
                  result.failed.length === 0 &&
                  'rendered'}
              </span>
            )}
          </div>
          {error && <Note tone="error">{error}</Note>}
        </Block>
      </Section>
    </Page>
  )
}

/**
 * A theme as a miniature of the app: bar strip, prompt with its sigil, a
 * selected row, and its tone swatches — all from its own tokens.
 */
function ThemeCard({
  name,
  tokens: t,
  current,
  tag,
  onPick,
}: {
  name: string
  tokens: ThemeTokens
  current: boolean
  /** What the selection means: "in use", "light", "dark · now". */
  tag: string | null
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`tcard${current ? ' cur' : ''}`}
      aria-pressed={current}
      onClick={onPick}
      title={current ? `${name} (${tag ?? 'chosen'})` : `Use ${name}`}
    >
      <span className="tcard-pv" style={{ background: t.bg }}>
        <span className="tcard-bar" style={{ background: t.surface }}>
          <i style={{ background: t.accent }} />
          <i style={{ background: t.dim }} />
          <i style={{ background: t.dim }} />
        </span>
        <span className="tcard-lp" style={{ background: t.surface }}>
          <span className="tcard-pr" style={{ color: t.fg }}>
            <span style={{ color: t.sigil }}>❯</span> fire
          </span>
          <span
            className="tcard-ln"
            style={{ background: t.selected, width: '88%' }}
          />
          <span
            className="tcard-ln"
            style={{ background: t.dim, opacity: 0.45, width: '62%' }}
          />
        </span>
        <span className="tcard-sw">
          {[t.accent, t.bang, t.warn, t.danger, t.good, t.fg].map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
      </span>
      <span className="tcard-cap">
        <span className="tcard-name">{name}</span>
        {tag && <span className="tcard-cur">{tag}</span>}
      </span>
    </button>
  )
}

/** `~/.config/scuttler/themes/<name>/colors.toml`: install from git, update, remove. */
function UserThemes() {
  const user = useUserThemes()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const run = (p: Promise<string>) => {
    setBusy(true)
    setNote(null)
    p.then(setNote)
      .catch((e) => setNote(String(e)))
      .finally(() => setBusy(false))
  }
  const install = () =>
    url.trim() &&
    run(
      installTheme(url.trim()).then((t) => {
        setUrl('')
        return `installed ${t.name}`
      }),
    )
  return (
    <Row
      label="Install from git"
      hint={
        <>
          Any Omarchy theme works as-is, or drop a <code>colors.toml</code> in{' '}
          <code>~/.config/scuttler/themes/&lt;name&gt;/</code>. A theme named
          after a built-in replaces it.
        </>
      }
      below={
        <>
          <div className="btnrow">
            <input
              className="grow"
              aria-label="Theme git URL"
              value={url}
              placeholder="https://github.com/…/omarchy-<name>-theme"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') install()
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || !url.trim()}
              onClick={install}
            >
              {busy ? 'working…' : 'install'}
            </button>
            {user.some((t) => t.installed) && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(
                    updateThemes().then((n) =>
                      n.length ? `updated ${n.join(', ')}` : 'all up to date',
                    ),
                  )
                }
              >
                update installed
              </button>
            )}
          </div>
          {user.length > 0 && (
            <ul className="plainlist">
              {user.map((t) => (
                <li key={t.name}>
                  <span>{t.name}</span>
                  {t.installed && (
                    <span className="dimtext">installed from git</span>
                  )}
                  <button
                    type="button"
                    className="btn dim"
                    disabled={busy}
                    onClick={() =>
                      run(removeTheme(t.name).then(() => `removed ${t.name}`))
                    }
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && <Note>{note}</Note>}
        </>
      }
    />
  )
}
