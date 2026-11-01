import { DEFAULT_BAR_LAYOUT } from '@scuttler/tui/bar/layout'
import type { Metadata } from 'next'
import Link from 'next/link'

import { DocsHeader } from '@/components/docs-header'
import { PANEL_INFO } from '@/lib/demo-data'
import { DOCS_URL, README_URL, VERSION } from '@/lib/site'

export const metadata: Metadata = {
  title: 'scuttler docs — scripts, plugins, config, panels',
  description:
    'Where scuttler is documented: the scripts, widget and plugin contracts, config.json, the panel triggers, themes, the Machine rung, and how to uninstall. The repo holds the text; this page is the map.',
  alternates: { canonical: '/docs' },
}

const SECTION = 'mx-auto max-w-[900px] px-8'
const H2 =
  'm-0 mb-5 text-[13px] font-medium uppercase tracking-[0.14em] text-(--dim)'
const PROSE = 'font-sans text-[15px] leading-[1.7] text-(--body) text-pretty'
const CODE = 'font-mono text-(--fg)'

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-lg border border-(--border) bg-(--chip) px-5 py-4 font-mono text-[13px] leading-[1.7] text-(--fg)">
      {children}
    </pre>
  )
}

function Note({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5 bg-(--bg) px-[22px] py-5">
      <span className="text-[13px] font-semibold">{title}</span>
      <span className="font-sans text-[13px] leading-[1.55] text-(--muted)">
        {children}
      </span>
    </div>
  )
}

function Doc({ file, children }: { file: string; children: React.ReactNode }) {
  return (
    <a href={`${DOCS_URL}/${file}`} className="whitespace-nowrap">
      {children}
    </a>
  )
}

const MANIFEST_JSON = `{
  "trigger": "uuid",
  "name": "UUID",
  "description": "Generate a v4 UUID"
}`

const QUERY_JSON = `{
  "items": [
    {
      "title": "Copy 3f9c1e2a-7b4d-4c8e-9a1f-2d6b8e4c0a55",
      "subtitle": "v4 · fresh every keystroke",
      "action": { "type": "copy", "value": "3f9c1e2a-7b4d-4c8e-9a1f-2d6b8e4c0a55" }
    }
  ]
}`

/* The bar's default arrangement, rendered from the kit's constant — the one the
 * app writes into a fresh config.json (invariant 10: imported, never retyped). */
const zone = (ids: { id: string }[]) =>
  ids.map((m) => `{ "id": "${m.id}" }`).join(', ')
const BAR_JSON = `"bar": {
  "enabled": true,
  "layout": {
    "left":   [${zone(DEFAULT_BAR_LAYOUT.left)}],
    "center": [${zone(DEFAULT_BAR_LAYOUT.center)}],
    "right":  [${zone(DEFAULT_BAR_LAYOUT.right)}]
  }
}`

export default function Docs() {
  return (
    <div className="min-h-screen bg-(--bg) text-(--fg)">
      <DocsHeader />

      {/* ---- scripts ---- */}
      <section id="scripts" className={`${SECTION} pb-20 pt-16`}>
        <h1 className="m-0 mb-4 text-[32px] font-bold tracking-[-0.03em]">
          Scripts are the plugin API.
        </h1>
        <p className={`m-0 mb-8 max-w-[70ch] ${PROSE}`}>
          Drop a TypeScript file (or any executable) into{' '}
          <code className={CODE}>~/.config/scuttler/scripts/</code> and its
          trigger word joins the launcher grammar — no build, no restart, no
          store. <code className={CODE}>.ts</code> runs under Bun. The bundled
          scripts (<code className={CODE}>json</code>,{' '}
          <code className={CODE}>ip</code>) are reference implementations and
          yours to edit. The full contract — actions, timeouts, the rules — is{' '}
          <Doc file="SCRIPTS.md">docs/SCRIPTS.md</Doc>; this is the shape.
        </p>

        <h2 className={H2}>The contract — two invocations</h2>
        <div className="grid gap-5">
          <div className="grid gap-2.5">
            <p className="m-0 font-mono text-sm text-(--body)">
              <code className={CODE}>&lt;script&gt; manifest</code> — print a
              JSON manifest to stdout, exit 0
            </p>
            <Pre>{MANIFEST_JSON}</Pre>
          </div>
          <div className="grid gap-2.5">
            <p className="m-0 font-mono text-sm text-(--body)">
              <code className={CODE}>&lt;script&gt; query &lt;args&gt;</code> —
              called on every keystroke (debounced)
            </p>
            <Pre>{QUERY_JSON}</Pre>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-px overflow-hidden rounded-xl border border-(--hair) bg-(--hair)">
          <Note title="widgets">
            One <code className={CODE}>.ts</code> file in{' '}
            <code className={CODE}>~/.config/scuttler/widgets/</code> owns a
            cell in the bar — a glyph, a tone, a hover card of rows — on the
            same manifest / tick shape.{' '}
            <Doc file="WIDGETS.md">docs/WIDGETS.md</Doc>
          </Note>
          <Note title="plugins">
            A directory with a Bun service and React cells and panels on the
            scuttler kit, with declared settings and permissions. The bundled
            usage, calendar and updates plugins are written to the same
            contract. <Doc file="PLUGINS.md">docs/PLUGINS.md</Doc>
          </Note>
          <Note title="themes">
            One <code className={CODE}>colors.toml</code> in Omarchy&rsquo;s
            format, rendered into the app and — with the Theme rung on —
            Ghostty, tmux, your prompt, delta, Claude Code and your editors.{' '}
            <Doc file="THEMES.md">docs/THEMES.md</Doc>
          </Note>
          <Note title="the machine">
            The <code className={CODE}>scuttler</code> CLI shipped in the app:
            de-shined macOS defaults, the shell base, a manifest of every file
            it writes, <code className={CODE}>doctor</code> and{' '}
            <code className={CODE}>remove</code>.{' '}
            <Doc file="SETUP.md">docs/SETUP.md</Doc>
          </Note>
        </div>
      </section>

      {/* ---- config ---- */}
      <section id="config" className="border-t border-(--hair) bg-(--bg2)">
        <div className={`${SECTION} py-20`}>
          <h2 className={H2}>Config</h2>
          <p className={`m-0 mb-6 max-w-[70ch] ${PROSE}`}>
            Everything lives in{' '}
            <code className={CODE}>~/.config/scuttler/config.json</code> —
            watched and hot-applied, in sync with the settings window both ways.
            Every key and what a fresh install has on is the{' '}
            <a href={README_URL}>README&rsquo;s Defaults table</a>; the bar
            block a fresh install writes is this:
          </p>
          <Pre>{BAR_JSON}</Pre>
          <p className={`m-0 mt-5 max-w-[70ch] ${PROSE}`}>
            Modules render in the order you list them; the clock is an ordinary
            module. Plugins and widgets join as{' '}
            <code className={CODE}>plugin:&lt;id&gt;</code> and{' '}
            <code className={CODE}>widget:&lt;id&gt;</code>. Displays with a
            notch have no usable center, so they take an optional{' '}
            <code className={CODE}>bar.notchedLayout</code> of the same shape;
            without one, the main layout applies with the center folded into the
            head of the right zone. The Desktop rung (
            <code className={CODE}>desktop.tiling</code>, off by default)
            renders{' '}
            <code className={CODE}>~/.config/aerospace/aerospace.toml</code>{' '}
            from a few knobs and reloads AeroSpace live; set{' '}
            <code className={CODE}>tiling.managed</code> to{' '}
            <code className={CODE}>false</code> and the file is yours.
          </p>
        </div>
      </section>

      {/* ---- panels ---- */}
      <section id="panels" className={`${SECTION} py-20`}>
        <h2 className={H2}>Panel triggers</h2>
        <p className={`m-0 mb-6 max-w-[70ch] ${PROSE}`}>
          Some trigger words open a full keyboard-driven TUI panel inside the
          launcher window instead of returning rows. They fuzzy-match like apps,
          so you don&rsquo;t have to type them exactly. Esc walks back; focus
          returns exactly where it was — including over a full-screen app. This
          list is the app&rsquo;s own registry plus the bundled plugins&rsquo;
          panels.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-px overflow-hidden rounded-xl border border-(--hair) bg-(--hair)">
          {PANEL_INFO.map((p) => (
            <Note key={p.id} title={`${p.id} ⏎`}>
              {p.hint.replace(' ▸', '')}
            </Note>
          ))}
        </div>
        <p className={`m-0 mt-5 max-w-[70ch] ${PROSE}`}>
          <code className={CODE}>agents ⏎</code> appears once agent monitoring
          is on (Settings → Agents) and{' '}
          <code className={CODE}>aerospace ⏎</code> once tiling is; everything
          else is always there.
        </p>
      </section>

      {/* ---- uninstall ---- */}
      <section id="uninstall" className="border-t border-(--hair) bg-(--bg2)">
        <div className={`${SECTION} py-20`}>
          <h2 className={H2}>Uninstall</h2>
          <p className={`m-0 max-w-[70ch] ${PROSE}`}>
            <code className={CODE}>scuttler remove</code> first if you turned
            the Machine rung on (it restores every default and file it touched,
            and asks before doing so). Then{' '}
            <code className={CODE}>brew uninstall --cask scuttler</code> and the
            five paths listed in the{' '}
            <a href={`${README_URL}`}>README&rsquo;s Uninstall section</a>. No
            daemons left behind; AeroSpace and JankyBorders stay until you
            uninstall them too.
          </p>
        </div>
      </section>

      <footer className="border-t border-(--hair)">
        <div
          className={`${SECTION} flex flex-wrap items-center justify-between gap-6 py-10 text-[13px] text-(--dim2)`}
        >
          <span>
            scuttler {VERSION} — because the apps won&rsquo;t launch themselves.
            Yarr.
          </span>
          <Link href="/" className="text-(--dim) hover:text-(--fg)">
            ← back to the site
          </Link>
        </div>
      </footer>
    </div>
  )
}
