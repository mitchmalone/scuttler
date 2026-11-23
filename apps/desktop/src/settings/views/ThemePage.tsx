import type { AppearanceMode } from '@scuttler/core/appearance'
import {
  type ThemeTokens,
  isLightColor,
  resolveTheme,
} from '@scuttler/tui/themes'
import { useEffect, useState } from 'react'

import {
  FOCUS_OWN_PAIR,
  FOCUS_USE_PAIR,
  focusChoice,
  isClock,
  pickTheme,
  withFocusChoice,
  withFocusHalf,
} from '../../lib/appearance-ui'
import type { AppearanceConfig } from '../../lib/config'
import {
  type ThemeResult,
  appearanceOf,
  applyThemeEverywhere,
} from '../../lib/theme'
import { BUILTIN_THEMES, themeNames } from '../../lib/themes'
import {
  type AppearanceInputs,
  appearanceInputs,
} from '../../lib/use-appearance-policy'
import {
  installTheme,
  removeTheme,
  updateThemes,
  useMergedThemes,
  useUserThemes,
} from '../../lib/user-themes'
import { pageDef, rungState } from '../pages'
import type { PageProps } from '../types'
import { Block, Note, Page, Row, Section, Segmented, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

const MODES: { id: AppearanceMode; label: string; hint: string }[] = [
  {
    id: 'system',
    label: 'system',
    hint: 'Follows macOS, including its sunrise/sunset schedule.',
  },
  { id: 'light', label: 'light', hint: 'Always the light half of the pair.' },
  { id: 'dark', label: 'dark', hint: 'Always the dark half of the pair.' },
  { id: 'schedule', label: 'schedule', hint: 'Our own clock.' },
]

/**
 * Settings → Theme (the Theme rung, DECISIONS 2026-09-11): the pick as a
 * gallery drawn from each theme's own tokens, the policy that decides which
 * theme is active when (`@scuttler/core/appearance`), Focus overrides, and the
 * rung itself — rendering the theme beyond the app.
 */
export function ThemePage({ config, set, patch }: PageProps) {
  const def = pageDef('theme')
  const appearance = appearanceOf(config)
  const merged = useMergedThemes(config)
  const names = themeNames(merged)
  const user = useUserThemes()
  const [inputs, setInputs] = useState<AppearanceInputs | null>(null)
  useEffect(() => {
    appearanceInputs().then(setInputs).catch(console.error)
  }, [])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ThemeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setAppearance = (p: Partial<AppearanceConfig>) =>
    set('appearance', { ...appearance, ...p })
  const applyNow = () => {
    setBusy(true)
    setError(null)
    applyThemeEverywhere(config)
      .then(setResult)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }
  const modeHint = MODES.find((m) => m.id === appearance.mode)?.hint
  const activeFocus = inputs?.modes.find((m) => m.id === inputs.focusMode)
  const builtins = names.filter((n) => BUILTIN_THEMES[n]).length
  const rung = rungState('theme', config)

  return (
    <Page
      icon={PAGE_ICONS.theme}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
      aside={<span className={`pill ${rung}`}>rung {rung}</span>}
    >
      <Section
        title="Theme"
        aside={`${builtins} built in · ${user.length} yours`}
      >
        <Block anchor="Themes">
          <div className="gallery">
            {names.map((name) => (
              <ThemeCard
                key={name}
                name={name}
                tokens={resolveTheme(name, merged)}
                current={name === config.theme}
                onPick={() => patch(pickTheme(config, inputs, name))}
              />
            ))}
          </div>
          <p className="blk-hint">
            A pick sticks in the slot the policy below is reading
            {activeFocus ? ` (Focus: ${activeFocus.name})` : ''}. Add your own
            under <code>&quot;themes&quot;</code> in config.json; partial
            overrides welcome.
          </p>
        </Block>
        <UserThemes />
      </Section>

      <Section title="Policy">
        <Row
          label="Mode"
          cfg="appearance.mode"
          hint={modeHint}
          below={
            appearance.mode === 'schedule' && (
              <>
                <div className="btnrow">
                  <span className="dimtext">light from</span>
                  <input
                    className="tiny center"
                    aria-label="light from"
                    value={appearance.schedule.light}
                    placeholder="07:00"
                    onChange={(e) =>
                      setAppearance({
                        schedule: {
                          ...appearance.schedule,
                          light: e.target.value,
                        },
                      })
                    }
                  />
                  <span className="dimtext">dark from</span>
                  <input
                    className="tiny center"
                    aria-label="dark from"
                    value={appearance.schedule.dark}
                    placeholder="19:00"
                    onChange={(e) =>
                      setAppearance({
                        schedule: {
                          ...appearance.schedule,
                          dark: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                {(!isClock(appearance.schedule.light) ||
                  !isClock(appearance.schedule.dark)) && (
                  <Note tone="error">
                    Times are HH:MM, 24h; until both parse, 07:00 / 19:00 apply.
                  </Note>
                )}
              </>
            )
          }
        >
          <Segmented
            options={MODES}
            value={appearance.mode}
            onChange={(mode) => setAppearance({ mode })}
          />
        </Row>
        <Row
          label="Pair"
          cfg="appearance.pair"
          hint="The mode picks one half; a Focus can override."
        >
          <span className="dimtext">light</span>
          <ThemeSelect
            value={appearance.pair.light}
            names={names}
            onChange={(light) =>
              setAppearance({ pair: { ...appearance.pair, light } })
            }
          />
          <span className="dimtext">dark</span>
          <ThemeSelect
            value={appearance.pair.dark}
            names={names}
            onChange={(dark) =>
              setAppearance({ pair: { ...appearance.pair, dark } })
            }
          />
        </Row>
      </Section>

      <Section title="Focus">
        {inputs === null ? (
          <Block anchor="Focus modes">
            <p className="blk-hint">reading Focus modes…</p>
          </Block>
        ) : inputs.modes.length === 0 ? (
          <Block anchor="Focus modes">
            <p className="blk-hint">
              No Focus modes found. Set them up in System Settings → Focus.
            </p>
          </Block>
        ) : (
          <>
            <span data-row="focus-modes" />
            {inputs.modes.map((m) => {
              const mapping = appearance.focus[m.id]
              const choice = focusChoice(mapping)
              return (
                <Row
                  key={m.id}
                  label={m.name}
                  hint={
                    <>
                      <code>{m.id}</code>
                      {inputs.focusMode === m.id ? ' · active now' : ''}
                    </>
                  }
                >
                  {choice === FOCUS_OWN_PAIR && typeof mapping === 'object' && (
                    <>
                      <span className="dimtext">light</span>
                      <ThemeSelect
                        value={mapping.light}
                        names={names}
                        narrow
                        onChange={(t) =>
                          setAppearance(
                            withFocusHalf(appearance, m.id, 'light', t),
                          )
                        }
                      />
                      <span className="dimtext">dark</span>
                      <ThemeSelect
                        value={mapping.dark}
                        names={names}
                        narrow
                        onChange={(t) =>
                          setAppearance(
                            withFocusHalf(appearance, m.id, 'dark', t),
                          )
                        }
                      />
                    </>
                  )}
                  <ThemeSelect
                    value={choice}
                    names={names}
                    onChange={(c) =>
                      setAppearance(withFocusChoice(appearance, m.id, c))
                    }
                    extra={
                      <>
                        <option value={FOCUS_USE_PAIR}>— (use the pair)</option>
                        <option value={FOCUS_OWN_PAIR}>its own pair…</option>
                      </>
                    }
                  />
                </Row>
              )
            })}
          </>
        )}
      </Section>

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
          hint="Only when the mode is light, dark or schedule: in system mode macOS is the source and scuttler follows it, not the other way round."
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
  onPick,
}: {
  name: string
  tokens: ThemeTokens
  current: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`tcard${current ? ' cur' : ''}`}
      aria-pressed={current}
      onClick={onPick}
      title={current ? `${name} (current)` : `Use ${name}`}
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
        <span className={current ? 'tcard-cur' : 'tcard-mode'}>
          {current ? 'current' : isLightColor(t.bg) ? 'light' : 'dark'}
        </span>
      </span>
    </button>
  )
}

function ThemeSelect({
  value,
  names,
  onChange,
  extra,
  narrow = false,
}: {
  value: string
  names: string[]
  onChange: (name: string) => void
  extra?: React.ReactNode
  narrow?: boolean
}) {
  return (
    <select
      className={narrow ? 'narrow' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {extra}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
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
