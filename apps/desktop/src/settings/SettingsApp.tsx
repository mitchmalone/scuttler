import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CornerDownLeft, Search } from 'lucide-react'
import {
  type ComponentType,
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import type { Config } from '../lib/config'
import { applyTheme } from '../lib/themes'
import { useMergedThemes } from '../lib/user-themes'
import {
  GROUPS,
  PAGES,
  type PageId,
  SEARCH_INDEX,
  pageDef,
  pageFromHash,
  rungState,
} from './pages'
import { type SearchHit, rowAnchor, searchSettings } from './search'
import type { PageProps } from './types'
import { AboutPage } from './views/AboutPage'
import { AgentsPage } from './views/AgentsPage'
import { BarPage } from './views/BarPage'
import { ColorPickerPage } from './views/ColorPickerPage'
import { DesktopPage } from './views/DesktopPage'
import { LauncherPage } from './views/LauncherPage'
import { MachinePage } from './views/MachinePage'
import { PluginsPage } from './views/PluginsPage'
import { QuicklinksPage } from './views/QuicklinksPage'
import { ThemePage } from './views/ThemePage'
import { UpdatesPage } from './views/UpdatesPage'
import { WidgetsPage } from './views/WidgetsPage'
import { PAGE_ICONS } from './views/icons'

/**
 * The settings window: a live view over config.json. Every edit autosaves
 * (debounced); the config watcher hot-applies everything (hotkey, shortcuts,
 * login item, links, bookmarks). The file stays the source of truth — hand-edits
 * keep working and update this window while it's open.
 *
 * Layout (Claude Design 1a + 1c, plans/active/2026-11-23-settings-redesign.md):
 * a grouped sidebar with a prompt-style search, one page at a time.
 */

const EMPTY_THEMES = { themes: {} }
const SAVE_DEBOUNCE_MS = 400
const FLASH_MS = 1400

const PAGE_VIEWS: Record<PageId, ComponentType<PageProps>> = {
  launcher: LauncherPage,
  bar: BarPage,
  quicklinks: QuicklinksPage,
  colorpicker: ColorPickerPage,
  theme: ThemePage,
  desktop: DesktopPage,
  machine: MachinePage,
  agents: AgentsPage,
  plugins: PluginsPage,
  widgets: WidgetsPage,
  updates: UpdatesPage,
  about: AboutPage,
}

export default function SettingsApp() {
  const [config, setConfig] = useState<Config | null>(null)
  // Deep link: `open_settings { tab }` puts the id in the URL hash for a fresh
  // window and emits `settings-tab` at an open one (the adopt prompt lands here).
  const [page, setPage] = useState<PageId>(() =>
    pageFromHash(window.location.hash),
  )
  const [query, setQuery] = useState('')
  // The highlighted search result; reset whenever the query changes.
  const [sel, setSel] = useState(0)
  useEffect(() => setSel(0), [query])
  const [error, setError] = useState<string | null>(null)
  const mergedThemes = useMergedThemes(config ?? EMPTY_THEMES)

  useEffect(() => {
    const un = listen<string>('settings-tab', (e) => {
      setQuery('')
      setPage(pageFromHash(e.payload))
    })
    return () => {
      un.then((u) => u())
    }
  }, [])

  // Autosave plumbing: don't write back what we just loaded or received from the
  // watcher (echo), and don't let our own write's config-changed event clobber
  // edits typed during the round-trip.
  const skipWrite = useRef(true)
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    invoke<Config>('read_config')
      .then((c) => {
        skipWrite.current = true
        setConfig(c)
      })
      .catch(console.error)
    const un = listen<Config>('config-changed', (e) => {
      if (JSON.stringify(e.payload) === lastWritten.current) return
      skipWrite.current = true
      setConfig(e.payload)
    })
    return () => {
      un.then((u) => u())
    }
  }, [])

  useEffect(() => {
    if (!config) return
    if (skipWrite.current) {
      skipWrite.current = false
      return
    }
    const t = setTimeout(() => {
      lastWritten.current = JSON.stringify(config)
      invoke('write_config', { config })
        .then(() => setError(null))
        .catch((e) => setError(String(e)))
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [config])

  useEffect(() => {
    if (config) applyTheme(config.theme, mergedThemes, 'settings')
  }, [config, mergedThemes])

  // Keep the hash in step so a reload stays on the page.
  useEffect(() => {
    history.replaceState(null, '', `#${page}`)
  }, [page])

  // Search lands on a row: scroll to it and flash it once the page renders.
  const mainRef = useRef<HTMLElement>(null)
  const [landing, setLanding] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!landing || !mainRef.current) return
    const el = mainRef.current.querySelector<HTMLElement>(
      `[data-row="${landing}"]`,
    )
    setLanding(null)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.classList.add('flash')
    const t = setTimeout(() => el.classList.remove('flash'), FLASH_MS)
    return () => clearTimeout(t)
  }, [landing, page])

  const goTo = (id: PageId) => {
    setQuery('')
    setPage(id)
    mainRef.current?.scrollTo({ top: 0 })
  }
  const land = (hit: SearchHit) => {
    setQuery('')
    setPage(hit.entry.page)
    setLanding(rowAnchor(hit.entry.label))
  }

  if (!config) return <div className="settings" />

  const patch = (p: Partial<Config>) => setConfig({ ...config, ...p })
  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    patch({ [key]: value })
  const View = PAGE_VIEWS[page]
  const hits = searchSettings(query, SEARCH_INDEX)

  return (
    <div className="settings">
      <div className="dragbar" data-tauri-drag-region />
      <aside className="side">
        <div className="brand" data-tauri-drag-region>
          <span className="sigil">❯</span>settings
        </div>
        <SearchBox
          query={query}
          onQuery={setQuery}
          hits={hits}
          sel={sel}
          onSel={setSel}
          onLand={land}
        />
        <nav className="nav" aria-label="Settings pages">
          {GROUPS.map((g) => (
            <Fragment key={g.id}>
              {g.label && <div className="grp">{g.label}</div>}
              {PAGES.filter((p) => p.group === g.id).map((p) => {
                const Icon = PAGE_ICONS[p.id]
                const rung = rungState(p.id, config)
                const active = p.id === page && !query
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`navitem${active ? ' act' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => goTo(p.id)}
                  >
                    <Icon size={15} strokeWidth={1.8} aria-hidden />
                    <span>{p.label}</span>
                    {rung && <span className={`st ${rung}`}>{rung}</span>}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </nav>
        <div className="sidefoot">
          <button
            type="button"
            className="linkish dim"
            title="Open config.json"
            onClick={() =>
              invoke('open_path', { target: 'config' }).catch(console.error)
            }
          >
            ~/.config/scuttler
          </button>
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        {error ? <div className="error-banner">{error}</div> : null}
        {query.trim() ? (
          <SearchResults query={query} hits={hits} sel={sel} onLand={land} />
        ) : (
          <View config={config} set={set} patch={patch} />
        )}
      </main>
    </div>
  )
}

/**
 * The search field is the prompt: the sigil, a block caret, Esc clears. ⌘F
 * focuses it from anywhere; ↑/↓ move through results, ↵ lands on the row.
 */
function SearchBox({
  query,
  onQuery,
  hits,
  sel,
  onSel: setSel,
  onLand,
}: {
  query: string
  onQuery: (q: string) => void
  hits: SearchHit[]
  sel: number
  onSel: (update: (s: number) => number) => void
  onLand: (hit: SearchHit) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const live = query.length > 0
  return (
    <label className={`search${live ? ' live' : ''}`}>
      {live ? (
        <span className="sigil">❯</span>
      ) : (
        <Search size={12} strokeWidth={1.8} aria-hidden />
      )}
      <input
        ref={ref}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label="Search settings"
        placeholder="search settings"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((s) => Math.min(s + 1, Math.max(hits.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter') {
            const hit = hits[sel]
            if (hit) {
              onLand(hit)
              ref.current?.blur()
            }
          } else if (e.key === 'Escape') {
            if (query) onQuery('')
            else ref.current?.blur()
          }
        }}
      />
      <kbd>{live ? 'esc' : '⌘F'}</kbd>
    </label>
  )
}

function SearchResults({
  query,
  hits,
  sel,
  onLand,
}: {
  query: string
  hits: SearchHit[]
  sel: number
  onLand: (hit: SearchHit) => void
}) {
  return (
    <article className="page">
      <header className="pagehead">
        <Search size={20} strokeWidth={1.8} aria-hidden className="pageicon" />
        <h1>
          {hits.length === 0
            ? `Nothing matches “${query.trim()}”`
            : `${hits.length} setting${hits.length === 1 ? '' : 's'} match “${query.trim()}”`}
        </h1>
      </header>
      <p className="pagedesc">
        Matched by the launcher&apos;s own fuzzy matcher, across every page.
      </p>
      {hits.length > 0 && (
        <section className="sec">
          <div className="box results">
            {hits.map((h, i) => (
              <button
                key={`${h.entry.page}:${h.entry.label}`}
                type="button"
                className={`hit${i === sel ? ' on' : ''}`}
                onClick={() => onLand(h)}
              >
                <span className="crumb">
                  {pageDef(h.entry.page).label} › {h.entry.section}
                </span>
                <span className="hit-t">
                  <Highlight text={h.entry.label} positions={h.positions} />
                </span>
                {h.entry.hint && <span className="hit-h">{h.entry.hint}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="legend">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>
            <CornerDownLeft size={10} strokeWidth={2} aria-hidden />
          </kbd>{' '}
          go to the setting
        </span>
        <span>
          <kbd>esc</kbd> clear
        </span>
      </div>
    </article>
  )
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>
  const on = new Set(positions)
  return (
    <>
      {[...text].map((ch, i) =>
        on.has(i) ? (
          <mark key={i}>{ch}</mark>
        ) : (
          <Fragment key={i}>{ch}</Fragment>
        ),
      )}
    </>
  )
}
