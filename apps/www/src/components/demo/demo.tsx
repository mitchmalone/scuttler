'use client'

import { parseInput } from '@scuttler/core/grammar'
import type { Row } from '@scuttler/core/rows'
import {
  type AskTurn,
  BUILTIN_THEMES,
  Launcher,
  launcherPrompt,
  themeNames,
  themeVars,
} from '@scuttler/tui'
import '@scuttler/tui/launcher.css'
import { useEffect, useRef, useState } from 'react'

import { useAppTheme } from '@/lib/app-theme'
import { type PanelId, askAnswer } from '@/lib/demo-data'
import {
  actionFor,
  computeDemoRows,
  launchedId,
  openedPanel,
} from '@/lib/demo-rows'
import { SEED_FRECENCY, TRIGGERS } from '@/lib/launch-index'

import { DemoBar } from './bar'
import {
  DnsPanel,
  StubPanel,
  UpdatesPanel,
  UsagePanel,
  WifiPanel,
} from './panels'

/** The app's defaults for the three things the prompt shows (config.rs). */
const TERMINAL = 'Ghostty'
const SIGIL = '❯'
const BANG_SIGIL = '$'
const TOAST_MS = 2600
const SAMPLES = [
  'gho',
  'ps',
  'displays',
  '!git status',
  'wifi',
  'usage',
  '? what are quicklinks',
  'gh tauri',
]

/**
 * The interactive demo: a mock desktop with the bar across the top and the
 * launcher panel hanging Spotlight-style below it.
 *
 * Everything the panel decides — grammar, fuzzy matching, ranking, row shapes —
 * runs in `@scuttler/core`; the prompt is the kit's `Launcher`, the same
 * component the app's panel window renders, and the TUI panels are the real
 * `@scuttler/tui` components. The website supplies a fake index and fake OS
 * data; it never forks engine logic or retypes the UI (invariants 5 and 10).
 */
export function Demo() {
  const [raw, setRaw] = useState('')
  const [selected, setSelected] = useState(0)
  const [frecency, setFrecency] =
    useState<Record<string, number>>(SEED_FRECENCY)
  const [toast, setToast] = useState('')
  // shared with the hero field, so the picker below retints the band above
  const [themeName, setThemeName] = useAppTheme()
  const [panel, setPanel] = useState<PanelId | null>(null)
  // `?` conversation as turns — the same AskSurface the app renders (invariant 10);
  // only the answers are canned.
  const [ask, setAsk] = useState<AskTurn[]>([])
  const [workspace, setWorkspace] = useState('2')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const stream = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(
    () => () => {
      clearTimeout(toastTimer.current)
      clearInterval(stream.current)
    },
    [],
  )

  const theme = BUILTIN_THEMES[themeName] ?? BUILTIN_THEMES.scuttler!

  const showToast = (message: string) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), TOAST_MS)
  }

  const parsed = parseInput(raw, TRIGGERS)
  const isBang = parsed.mode === 'bang'
  const isAskMode = parsed.mode === 'ask'
  const rows = computeDemoRows(raw, frecency)
  const sel = Math.min(selected, Math.max(rows.length - 1, 0))

  const closePanel = () => {
    setPanel(null)
    setRaw('')
    setSelected(0)
    inputRef.current?.focus()
  }

  const askBusy = ask.some((t) => !t.done)
  const askActive = isAskMode && ask.length > 0
  const askScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = askScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ask])

  const { sigil, placeholder } = launcherPrompt({
    mode: parsed.mode,
    draftStep: null,
    loremMenu: false,
    askActive,
    askBusy,
    sigil: SIGIL,
    bangSigil: BANG_SIGIL,
  })

  /** Adds a turn, "thinks" for a beat, then types the canned answer out a few
   * characters a frame like a streamed reply. Follow-ups append; the first
   * question stays pinned in the header. */
  const startAsk = (prompt: string) => {
    const text = askAnswer(prompt)
    clearInterval(stream.current)
    setAsk((turns) => [...turns, { prompt, answer: '', done: false }])
    let i = -40 // ~640 ms of the thinking state before the first delta
    stream.current = setInterval(() => {
      i += 3
      if (i < 0) return
      const done = i >= text.length
      setAsk((turns) => {
        const last = turns[turns.length - 1]
        return last
          ? [...turns.slice(0, -1), { ...last, answer: text.slice(0, i), done }]
          : turns
      })
      if (done) clearInterval(stream.current)
    }, 16)
  }

  const fire = (row: Row | undefined) => {
    if (!row) return
    const opens = openedPanel(row)
    if (opens) {
      setPanel(opens)
      setRaw('')
      setSelected(0)
      setToast('')
      return
    }
    const id = launchedId(row)
    if (id) setFrecency((f) => ({ ...f, [id]: (f[id] ?? 0) + 1 }))
    showToast('⏎ ' + actionFor(row) + '  ·  panel dismissed, focus returned')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const move = (d: number) => {
      e.preventDefault()
      if (rows.length > 0) {
        setSelected(
          (Math.min(selected, rows.length - 1) + d + rows.length) % rows.length,
        )
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (ask.length > 0) {
        clearInterval(stream.current)
        setAsk([])
      }
      setRaw('')
      setSelected(0)
      setToast('')
      return
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) return move(1)
    if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) return move(-1)
    if (e.metaKey && e.key >= '1' && e.key <= '8') {
      e.preventDefault()
      fire(rows[Number(e.key) - 1])
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isBang) {
        showToast(
          '⏎ sent to ' + TERMINAL + ' ▸ ' + (parsed.command || 'new window'),
        )
      } else if (isAskMode) {
        if (parsed.prompt.trim() && !askBusy) {
          startAsk(parsed.prompt.trim())
          setRaw('?')
        }
      } else {
        fire(rows[sel])
      }
    }
  }

  /* Two token sets, one source. The panel kit resolves through --tui-*; the
     launcher and bar stylesheets resolve through the unprefixed panel names,
     which on this page would otherwise hit the *site* palette. `themeVars` is
     the kit's own mapping, so neither is a second copy. The launcher window is
     translucent, so its `--bg` is the glass token, as in the app. */
  const scopeVars = {
    '--tui-bg': theme.glass,
    '--tui-surface': theme.surface,
    '--tui-border': theme.border,
    '--tui-frame': theme.border,
    '--tui-fg': theme.fg,
    '--tui-dim': theme.dim,
    '--tui-accent': theme.accent,
    '--tui-selected': theme.selected,
    ...themeVars(theme, 'panel'),
    '--bg': theme.glass,
  } as React.CSSProperties

  const panelBody = () => {
    if (panel === 'wifi')
      return <WifiPanel onClose={closePanel} onToast={showToast} />
    if (panel === 'dns') return <DnsPanel onClose={closePanel} />
    if (panel === 'usage') return <UsagePanel onClose={closePanel} />
    if (panel === 'updates') return <UpdatesPanel onClose={closePanel} />
    if (panel) return <StubPanel id={panel} onClose={closePanel} />
    return null
  }

  return (
    <div style={scopeVars}>
      <div
        onClick={() => !panel && inputRef.current?.focus()}
        className="relative h-[620px] overflow-hidden rounded-[14px] border border-(--hair)"
        style={{
          background:
            'radial-gradient(120% 90% at 75% 10%, #3d2350 0%, #26203f 42%, #1c1d2d 75%, #14151f 100%)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 40% at 20% 85%, rgba(255,107,140,0.22) 0%, transparent 70%)',
          }}
        />

        <DemoBar live workspace={workspace} onWorkspace={setWorkspace} />

        {/* above the aurora wash, below the bar (z-10) so hover cards win */}
        <div className="relative z-[5] flex h-full items-start justify-center px-8 pt-[150px]">
          <div className="w-full max-w-[620px]">
            {panel ? (
              <div
                className="overflow-hidden rounded-[10px]"
                style={{ boxShadow: 'var(--shadow)' }}
              >
                {panelBody()}
              </div>
            ) : (
              <div
                className="font-mono"
                style={{
                  boxShadow: 'var(--shadow)',
                  borderRadius: 10,
                  color: theme.fg,
                }}
              >
                <Launcher
                  mode={parsed.mode}
                  sigil={sigil}
                  placeholder={placeholder}
                  value={raw}
                  inputRef={inputRef}
                  onChange={(e) => {
                    // Leaving ? mode ends the conversation; typing a
                    // follow-up keeps it.
                    if (ask.length > 0 && !e.target.value.startsWith('?')) {
                      clearInterval(stream.current)
                      setAsk([])
                    }
                    setRaw(e.target.value)
                    setSelected(0)
                    setToast('')
                  }}
                  onKeyDown={onKeyDown}
                  askTurns={ask}
                  askBusy={askBusy}
                  askScrollRef={askScrollRef}
                  askPrompt={isAskMode ? parsed.prompt : ''}
                  bangCommand={isBang ? parsed.command : ''}
                  terminal={TERMINAL}
                  rows={rows}
                  selected={sel}
                  // The fake index carries emoji icons; engine rows (url, math,
                  // emoji, panels) bring their own glyph.
                  renderIcon={(row) => (
                    <span className="icon glyph">{row.icon ?? row.glyph}</span>
                  )}
                  onRowMouseDown={(row, e) => {
                    e.preventDefault()
                    fire(row)
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* try-chips + theme picker, on the page rather than inside the desktop */}
      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-(--dim2)">try</span>
          {SAMPLES.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setPanel(null)
                clearInterval(stream.current)
                setAsk([])
                setRaw(label)
                setSelected(0)
                setToast('')
                inputRef.current?.focus()
              }}
              className="cursor-pointer rounded-md border border-(--border) bg-(--chip) px-[11px] py-1.5 font-mono text-[12.5px] text-(--body) hover:border-(--accent) hover:text-(--fg)"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-(--dim2)">
          theme
          <select
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            className="cursor-pointer rounded-md border border-(--border) bg-(--chip) px-2.5 py-1.5 font-mono text-[12.5px] text-(--body) outline-none hover:border-(--accent)"
          >
            {themeNames({}).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="mt-3.5 min-h-[18px] text-[12.5px]"
        style={{ color: toast ? 'var(--green)' : 'transparent' }}
      >
        {toast}
      </div>
    </div>
  )
}
