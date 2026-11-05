// Leaf imports, not the kit's root: this page is a Server Component and the
// root re-exports hooks, which Next refuses to load on the server (the site
// build broke this way 2026-10-28 to 2026-11-01).
import { agentStateLabel } from '@scuttler/tui/bar'
import { AgentStateIcon } from '@scuttler/tui/bar/agent-icons'
import { GithubIcon, XIcon } from '@scuttler/tui/icons'
import {
  AppWindow,
  ArrowUpRight,
  Bot,
  Camera,
  ChevronRight,
  ClipboardList,
  FileCode2,
  Gauge,
  LayoutGrid,
  ListChecks,
  MessageCircleQuestion,
  Palette,
  PanelTop,
  Play,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Star,
  Tag,
  Terminal,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

import { AgentSpotlight } from '@/components/agent-spotlight'
import { BarStrip } from '@/components/bar-strip'
import { BarThemeScope } from '@/components/bar-theme-scope'
import { Demo } from '@/components/demo/demo'
import { HeroField, HeroPrompt } from '@/components/hero-field'
import { InstallTabs } from '@/components/install-tabs'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AGENT_STATE_BLURBS } from '@/lib/demo-data'
import { GITHUB_URL, RELEASE, RELEASES_URL, VERSION } from '@/lib/site'

const MONO_CODE = 'font-mono text-(--fg)'
const SECTION = 'mx-auto max-w-[1080px] px-8'
const EYEBROW =
  'm-0 text-[13px] font-medium uppercase tracking-[0.14em] text-(--dim)'
const PROSE = 'font-sans text-[17px] leading-[1.6] text-(--body) text-pretty'
const CARD_BODY = 'font-sans text-sm leading-[1.6] text-(--muted)'

const FEATURES = [
  {
    icon: <ChevronRight size={22} strokeWidth={2} className="text-(--green)" />,
    title: 'Launch, fuzzy & frecency-ranked',
    body: (
      <>
        Apps and System Settings panes, scored fzf-family and ranked by your
        actual usage. Ties break on frecency, never the other way around.
      </>
    ),
  },
  {
    icon: (
      <SquareTerminal size={22} strokeWidth={1.75} className="text-(--amber)" />
    ),
    title: 'Bang mode to your terminal',
    body: (
      <>
        <code className={MONO_CODE}>!git status ⏎</code> hands the command to
        Ghostty, verbatim. No wrapper, no escaping surprises.
      </>
    ),
  },
  {
    icon: (
      <FileCode2 size={22} strokeWidth={1.75} className="text-(--accent)" />
    ),
    title: 'Hackable in any language',
    body: (
      <>
        Drop an executable in{' '}
        <code className={MONO_CODE}>~/.config/scuttler/scripts/</code> — its
        trigger word is live before you switch back to the panel.{' '}
        <code className={MONO_CODE}>json</code> and{' '}
        <code className={MONO_CODE}>ip</code> ship bundled.
      </>
    ),
  },
  {
    icon: (
      <ClipboardList size={22} strokeWidth={1.75} className="text-(--dim)" />
    ),
    title: 'Clipboard, math, emoji',
    body: (
      <>
        <code className={MONO_CODE}>clip</code> keeps 200 text items and never
        records concealed types. <code className={MONO_CODE}>2*(14.5+3)</code>{' '}
        computes inline; <code className={MONO_CODE}>:fire</code> picks emoji.
        Enter copies.
      </>
    ),
  },
  {
    icon: (
      <ArrowUpRight size={22} strokeWidth={1.75} className="text-(--dim)" />
    ),
    title: 'Quicklinks & URLs',
    body: (
      <>
        Type a URL to open it, or add it in-panel with a name, browser and
        favicon. <code className={MONO_CODE}>{'{query}'}</code> templates give
        you <code className={MONO_CODE}>yt cute otters ⏎</code>.
      </>
    ),
  },
  {
    icon: <Settings size={22} strokeWidth={1.75} className="text-(--dim)" />,
    title: 'Settings you can edit by hand',
    body: (
      <>
        A real settings window and a watched, hot-applied{' '}
        <code className={MONO_CODE}>config.json</code>. Both stay in sync;
        neither is the second-class citizen.
      </>
    ),
  },
  {
    icon: <PanelTop size={22} strokeWidth={1.75} className="text-(--cta)" />,
    title: 'The bar',
    body: (
      <>
        An Omarchy-flat menubar replacement: no boxes, dim glyphs, one solid
        block on the active workspace. Every cell opens a panel in the launcher,
        and it wears the same tokens.
      </>
    ),
  },
  {
    icon: <AppWindow size={22} strokeWidth={1.75} className="text-(--cta)" />,
    title: 'TUI panels in the launcher',
    body: (
      <>
        <code className={MONO_CODE}>wifi ⏎</code>,{' '}
        <code className={MONO_CODE}>dns ⏎</code>,{' '}
        <code className={MONO_CODE}>usage ⏎</code> and more — keyboard-driven
        panels inside the launcher window. Esc walks back; focus returns exactly
        where it was.
      </>
    ),
  },
  {
    icon: <Bot size={22} strokeWidth={1.75} className="text-(--green)" />,
    title: 'Agent monitoring',
    body: (
      <>
        Claude and Codex sessions as bar cells, boxed by tmux session, ordered
        by tab. A session that needs you breathes in the warn colour; click a
        cell to jump straight to the pane. Off by default.
      </>
    ),
  },
  {
    icon: <Gauge size={22} strokeWidth={1.75} className="text-(--dim)" />,
    title: 'Token usage, locally',
    body: (
      <>
        <code className={MONO_CODE}>usage ⏎</code> parses agent journals on
        disk: tokens by day and model, plus opt-in account limits with reset
        countdowns. No token refresh, ever.
      </>
    ),
  },
  {
    icon: (
      <MessageCircleQuestion
        size={22}
        strokeWidth={1.75}
        className="text-(--dim)"
      />
    ),
    title: '? agent mode',
    body: (
      <>
        Press <code className={MONO_CODE}>?</code> and ask — streamed answers
        from your own <code className={MONO_CODE}>claude</code> or{' '}
        <code className={MONO_CODE}>codex</code> CLI in a caged child process.
        Off by default.
      </>
    ),
  },
  {
    icon: <LayoutGrid size={22} strokeWidth={1.75} className="text-(--cta)" />,
    title: 'The desktop layer',
    body: (
      <>
        Tiling via AeroSpace with a config scuttler writes for you — a modifier,
        gaps, workspaces, done. Off until you turn it on, in setup or Settings →
        Desktop. Opt-in JankyBorders in your theme&rsquo;s accent, and the
        pre-Tahoe window corners back if you want them. Flip <em>manage</em> off
        and the toml is yours.
      </>
    ),
  },
  {
    icon: <Camera size={22} strokeWidth={1.75} className="text-(--cta)" />,
    title: 'Screenshots to your agent',
    body: (
      <>
        <code className={MONO_CODE}>ss ⏎</code> — a grid of your latest
        captures, newest first. Enter puts the file on the clipboard;{' '}
        <code className={MONO_CODE}>⌘V</code> into Claude, Cursor or a browser.
        The whole feature is <code className={MONO_CODE}>⌥Space ss ⏎ ⌘V</code>.
      </>
    ),
  },
  {
    icon: <ListChecks size={22} strokeWidth={1.75} className="text-(--dim)" />,
    title: 'Updates you can act on',
    body: (
      <>
        <code className={MONO_CODE}>updates ⏎</code> is a ledger: Homebrew, the
        App Store, pnpm and mise, a count in the bar, each package a click or
        Enter from upgrading in place with live output. scuttler&rsquo;s own
        releases arrive the same way, verified against our signature.
      </>
    ),
  },
  {
    icon: <Palette size={22} strokeWidth={1.75} className="text-(--dim)" />,
    title: '14 themes, one colors.toml',
    body: (
      <>
        From gruvbox to rose-pine, in Omarchy&rsquo;s{' '}
        <code className={MONO_CODE}>colors.toml</code> format verbatim, so any
        Omarchy theme ports by copying one file. Turn the Theme rung on and it
        styles Ghostty, tmux, your prompt, delta and Claude Code too; a
        light/dark pair follows macOS, a schedule, or a Focus.
      </>
    ),
  },
  {
    icon: (
      <ShieldCheck size={22} strokeWidth={1.75} className="text-(--green)" />
    ),
    title: 'Zero permissions, opt-in everything',
    body: (
      <>
        No Accessibility, no Full Disk Access, no telemetry. A prompt only ever
        follows a toggle you flipped, and the network is used only to do what
        you asked — a favicon, your usage limits, the update check — never to
        report on you.
      </>
    ),
  },
]

const BAR_MODULES = [
  {
    name: 'workspaces',
    body: 'AeroSpace workspaces, clickable and hotkey-tracked, once the Desktop rung is on. The solid block is where you are.',
  },
  {
    name: 'agents',
    body: 'Claude/Codex session cells, boxed by tmux session. Hover for the task; click to jump.',
  },
  {
    name: 'front app',
    body: 'The focused application, dim and truncated at 32ch. Never shouts.',
  },
  {
    name: 'clock',
    body: 'An ordinary module that usually sits in the center zone — move it wherever you like.',
  },
  {
    name: 'wifi · awake · usage · updates · battery',
    body: 'Right-zone glyph cells, each with a hover card and a panel behind it. Alert states go warn, then danger. Fail-soft: a cell with nothing to say hides, never errors.',
  },
  {
    name: 'yours',
    body: 'A widget is one TypeScript file answering manifest and tick; a plugin is a directory with its own React cell and panel. Same contract philosophy as scripts.',
  },
]

const COMPARISON = {
  columns: ['scuttler', 'Raycast', 'Alfred', 'Sketchybar'],
  rows: [
    [
      'feels like',
      'a shell prompt',
      'a polished app',
      'a polished app',
      'a status bar',
    ],
    [
      'extensions',
      'any executable in a folder',
      'React + a store',
      'workflows',
      'shell plugins',
    ],
    ['menubar replacement', 'yes — bar + launcher', 'no', 'no', 'bar only'],
    [
      'theming',
      'one palette, everywhere — terminal, tmux, prompt, macOS Focus',
      'its own window',
      'its own window',
      'the bar, by hand',
    ],
    [
      'license',
      'MIT, open source',
      'closed, freemium',
      'closed, paid Powerpack',
      'open source',
    ],
  ],
}

const ROADMAP = [
  ['done', 'The bar', 'zones, notch profiles, hover cards, a bar per display'],
  ['done', 'Panels', 'wifi ⏎ · dns ⏎ · ss ⏎ · theme ⏎ · setup ⏎ and more'],
  ['done', 'Agents', 'cells by shape, tmux groups, usage ⏎, ? mode'],
  [
    'done',
    'Plugins and widgets',
    'Bun services, React cells and panels, declared permissions',
  ],
  ['done', 'Desktop rung', 'AeroSpace managed, borders, corners'],
  [
    'done',
    'Theme rung',
    "Omarchy's colors.toml into Ghostty, tmux, prompt, delta, Claude Code, your editors",
  ],
  [
    'done',
    'Machine rung',
    'de-shined defaults, the shell base, a manifest, doctor, remove',
  ],
  [
    'done',
    'First-launch setup',
    'one question per screen; setup ⏎ runs it again',
  ],
  [
    'done',
    'Updates',
    'a ledger across package managers; upgrades in place; self-update',
  ],
  [
    'done',
    'The rename',
    'scuttlarr became scuttler, at www.scuttler.app, in v0.8.5',
  ],
  [
    'todo',
    'Light mode first-class',
    'Solarized Light and Catppuccin Latte on every surface',
  ],
  [
    'todo',
    'Plugins slice G',
    'the remaining first-party panels move to plugins',
  ],
] as const

const MARK = {
  done: { glyph: '✓', className: 'text-(--green)' },
  wip: { glyph: '◐', className: 'text-(--amber)' },
  todo: { glyph: '○', className: 'text-(--dim2)' },
}

export default function Home() {
  return (
    <div className="min-h-screen bg-(--bg) text-(--fg)">
      <SiteHeader />

      {/* ---- hero: the pixel field band (design 2c), then the long copy ---- */}
      <HeroField>
        <div className="mx-auto flex min-h-[calc(100svh-69px)] max-w-[1080px] flex-col items-center justify-center gap-[22px] px-8 py-24 text-center">
          <h1 className="m-0 max-w-[18ch] text-[clamp(2.25rem,6vw,3.375rem)] font-bold leading-[1.05] tracking-[-0.035em] text-balance">
            The terminal developer&rsquo;s desktop for macOS.
          </h1>
          <HeroPrompt />
          <div className="flex flex-wrap items-center justify-center gap-3">
            {RELEASE.artifacts ? (
              <ButtonLink
                variant="cta"
                size="lg"
                href={RELEASE.artifacts.dmg.url}
              >
                <Terminal size={16} strokeWidth={2} />
                Download for Mac
              </ButtonLink>
            ) : null}
            <ButtonLink
              variant="outline"
              size="lg"
              href={GITHUB_URL}
              className="bg-(--bg)"
            >
              <Star size={16} strokeWidth={1.75} />
              Star on GitHub
            </ButtonLink>
          </div>
          <span className="rounded bg-(--bg) px-1.5 py-0.5 text-[12.5px] text-(--dim2)">
            {VERSION} · Apple Silicon
            {RELEASE.signed ? ' · signed & notarized' : null}
          </span>
        </div>
      </HeroField>

      <section
        className={`${SECTION} grid justify-items-start gap-[26px] pb-10 pt-16`}
      >
        <Badge variant="eyebrow">
          <span className="size-1.5 rounded-full bg-(--green)" />
          macOS · Apple Silicon · free &amp; open source
        </Badge>
        <p
          className={`m-0 max-w-[64ch] font-sans text-[19px] leading-[1.6] text-(--body) text-pretty`}
        >
          A menubar replacement, a launcher that dresses up as a shell prompt,
          one theme rendered into everything, and a keyboard-first way of
          working — with tiling, de-shined defaults and a fast shell a toggle
          away. The Omarchy shape, without Linux. Install gets the bar and the
          launcher; the rest is a rung you turn on. Hit{' '}
          <kbd className="rounded-[5px] border border-b-2 border-(--border) px-1.5 py-px text-[15px] text-(--fg)">
            ⌥Space
          </kbd>{' '}
          and run your Mac without touching the mouse.
        </p>

        {/* welcome video drops in here — placeholder frame until footage exists */}
        <div className="mt-6 w-full">
          <div
            className="flex aspect-video flex-col items-center justify-center gap-[18px] rounded-[14px] border border-(--hair)"
            style={{
              boxShadow: 'var(--shadow)',
              background:
                'repeating-linear-gradient(-45deg, var(--bg2) 0, var(--bg2) 14px, var(--chip) 14px, var(--chip) 28px)',
            }}
          >
            <span className="inline-flex size-[68px] items-center justify-center rounded-full border border-(--border) bg-(--panel) text-(--cta)">
              <Play size={26} strokeWidth={2} />
            </span>
            <span className="text-[12.5px] text-(--dim)">
              welcome video — coming soon
            </span>
          </div>
        </div>
      </section>

      {/* ---- live demo ---- */}
      <section id="demo" className={`${SECTION} pb-24 pt-10`}>
        <h2 className={`${EYEBROW} mb-6`}>
          This is not a screenshot — type in it
        </h2>
        <Demo />
      </section>

      {/* ---- features ---- */}
      <section id="features" className={`${SECTION} pb-24`}>
        <h2 className={`${EYEBROW} mb-6`}>What it does</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-px overflow-hidden rounded-xl border border-(--hair) bg-(--hair)">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="grid content-start gap-2.5 bg-(--bg) px-6 py-[26px]"
            >
              {f.icon}
              <h3 className="m-0 text-[15px] font-semibold">{f.title}</h3>
              <p className={`m-0 ${CARD_BODY}`}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- the bar ---- */}
      <section id="bar" className={`${SECTION} py-24`}>
        <div className="mb-7 grid max-w-[70ch] gap-4">
          <h2 className={EYEBROW}>The bar — your menubar, replaced</h2>
          <p className={`m-0 ${PROSE}`}>
            One flat 30px strip, inspired by Omarchy: no boxes, dim glyphs, a
            solid block marking the active workspace. Modules live in explicit{' '}
            <code className={MONO_CODE}>left</code> /{' '}
            <code className={MONO_CODE}>center</code> /{' '}
            <code className={MONO_CODE}>right</code> zones under{' '}
            <code className={MONO_CODE}>bar.layout</code>, and notched displays
            get their own arrangement. Rust pushes snapshots at 1&nbsp;Hz — the
            webview is a pure listener.
          </p>
        </div>
        <BarStrip />
        <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-px overflow-hidden rounded-xl border border-(--hair) bg-(--hair)">
          {BAR_MODULES.map((m) => (
            <div key={m.name} className="grid gap-1.5 bg-(--bg) px-[22px] py-5">
              <span className="text-[13px] font-semibold">{m.name}</span>
              <span className="font-sans text-[13px] leading-[1.55] text-(--muted)">
                {m.body}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- agent monitoring ---- */}
      <section id="agents" className="border-t border-(--hair) bg-(--bg2)">
        <div
          className={`${SECTION} grid items-start gap-16 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]`}
        >
          <div className="grid gap-4">
            <h2 className={EYEBROW}>Agent monitoring</h2>
            <p className={`m-0 ${PROSE}`}>
              If you run coding agents in tmux all day, the bar is their status
              board. Every session is one glyph, grouped by tmux session and
              ordered by tab. Hover a cell for the task and state; click it and
              scuttler drops you into the exact pane.
            </p>
            {/* Glyphs, labels and colours all come from the kit — `bar-agent-*`
                is the same class the real cell wears, so this legend cannot
                disagree with the bar above it. */}
            <BarThemeScope className="mt-2 grid gap-2.5 text-[13px]">
              {AGENT_STATE_BLURBS.map(({ state, blurb }) => (
                <div key={state} className="flex items-center gap-3">
                  <span className={`bar-agent bar-agent-${state}`}>
                    <AgentStateIcon state={state} />
                  </span>
                  <span className="min-w-[12ch] text-(--fg)">
                    {agentStateLabel(state)}
                  </span>
                  <span className="text-(--muted)">{blurb}</span>
                </div>
              ))}
            </BarThemeScope>
          </div>
          <AgentSpotlight />
        </div>
      </section>

      {/* ---- comparison ---- */}
      <section id="compare" className={`${SECTION} py-24`}>
        <h2 className={`${EYEBROW} mb-6`}>Picking a launcher and a bar</h2>
        <div className="overflow-hidden rounded-xl border border-(--hair)">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {COMPARISON.columns.map((c, i) => (
                  <TableHead
                    key={c}
                    className={i === 0 ? 'font-bold text-(--fg)' : undefined}
                  >
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPARISON.rows.map(([label, ...cells]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  {cells.map((cell, i) => (
                    <TableCell
                      key={i}
                      className={i === 0 ? 'text-(--fg)' : undefined}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3.5 text-[12.5px] text-(--dim2)">
          All fine tools, and all of them do things scuttler doesn&rsquo;t. The
          launcher and the bar are where they overlap; the rungs above them —
          Desktop, Theme, Machine — are what none of them try. This table is
          about temperament, not superiority.
        </p>
      </section>

      {/* ---- install ---- */}
      <section id="install" className={`${SECTION} pb-24`}>
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-6">
          <h2 className={EYEBROW}>Install</h2>
          <span className="text-[12.5px] text-(--dim2)">
            Apple Silicon · {VERSION}
            {RELEASE.signed ? ' signed & notarized' : null}
          </span>
        </div>
        <InstallTabs />
        <p className="mt-[18px] max-w-[74ch] font-sans text-sm leading-[1.7] text-(--muted) text-pretty">
          First run: the panel opens on a short setup, one question per screen
          (hotkey, bar, agents, theme, tiling). One Enter applies it, Esc puts
          it off, and <code className={MONO_CODE}>setup ⏎</code> runs it again.
          A default config is written to{' '}
          <code className={MONO_CODE}>~/.config/scuttler/config.json</code>, and
          scuttler registers as a login item (toggleable in settings). The bar
          and the launcher are on by default; tiling and the Theme and Machine
          rungs stay off until you turn them on. Upgrading keeps the settings
          you had.
        </p>
      </section>

      {/* ---- roadmap ---- */}
      <section id="roadmap" className="border-t border-(--hair) bg-(--bg2)">
        <div
          className={`${SECTION} grid items-start gap-16 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]`}
        >
          <div className="grid gap-4">
            <h2 className={EYEBROW}>
              Building in the open — the rungs are in, the name is next
            </h2>
            <p className={`m-0 ${PROSE}`}>
              {VERSION} is the whole shape in daily use: bar and launcher on
              install, then Desktop, Theme and Machine as toggles you turn on —
              the Omarchy shape, without Linux. Explicit non-goals hold: no file
              search, no snippets, no granted permissions, nothing that phones
              home. What&rsquo;s open, and what would start each item, is the
              repo&rsquo;s{' '}
              <a href={`${GITHUB_URL}/blob/main/docs/ROADMAP.md`}>ROADMAP</a>.
            </p>
          </div>
          <div className="grid gap-3 rounded-xl border border-(--hair) bg-(--bg) px-6 py-[22px] text-[13px]">
            {ROADMAP.map(([state, title, note]) => (
              <div key={title} className="flex gap-3">
                <span className={`min-w-[1.2em] ${MARK[state].className}`}>
                  {MARK[state].glyph}
                </span>
                <span className="text-(--fg)">{title}</span>
                <span className="ml-auto text-right text-(--dim)">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className="border-t border-(--hair)">
        <div
          className={`${SECTION} flex flex-wrap items-center justify-between gap-6 py-10`}
        >
          <div className="flex items-center gap-3.5">
            <Image
              src="/menubar-icon.png"
              alt=""
              width={34}
              height={34}
              className="opacity-75 [filter:var(--logo)]"
            />
            <span className="text-[13px] text-(--dim2)">
              scuttler {VERSION} — scuttle the ship, sail the wreck. The apps
              still won&rsquo;t launch themselves. Yarr.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-[13px]">
            <a
              href={GITHUB_URL}
              className="inline-flex items-center gap-[7px] text-(--dim) hover:text-(--fg) hover:no-underline"
            >
              <GithubIcon size={15} />
              github
            </a>
            <Link
              href="/docs"
              className="inline-flex items-center gap-[7px] text-(--dim) hover:text-(--fg) hover:no-underline"
            >
              <FileCode2 size={15} strokeWidth={1.75} />
              scripts api
            </Link>
            <a
              href={RELEASES_URL}
              className="inline-flex items-center gap-[7px] text-(--dim) hover:text-(--fg) hover:no-underline"
            >
              <Tag size={15} strokeWidth={1.75} />
              releases
            </a>
            <a
              href="https://x.com/mitchmalone"
              className="inline-flex items-center gap-[7px] text-(--dim) hover:text-(--fg) hover:no-underline"
            >
              <XIcon size={15} />
              @mitchmalone
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
