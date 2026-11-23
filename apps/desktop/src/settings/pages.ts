/**
 * The settings window's map: every page, its sidebar group, the config key it
 * writes, its rung state, the ids older builds used in `open_settings { tab }`,
 * and the rows search can find. Pure data — the shell renders it, search.ts
 * matches it, the tests pin it. Adding a page is one entry here plus its
 * component in SettingsApp's PAGE_VIEWS.
 */

export type PageId =
  | 'launcher'
  | 'bar'
  | 'quicklinks'
  | 'colorpicker'
  | 'theme'
  | 'desktop'
  | 'machine'
  | 'agents'
  | 'plugins'
  | 'widgets'
  | 'updates'
  | 'about'

export type GroupId = 'core' | 'rungs' | 'extend' | 'scuttler'

/** Sidebar groups in order; the first has no heading. */
export const GROUPS: readonly { id: GroupId; label: string | null }[] = [
  { id: 'core', label: null },
  { id: 'rungs', label: 'Rungs' },
  { id: 'extend', label: 'Extend' },
  { id: 'scuttler', label: 'scuttler' },
]

export type PageDef = {
  id: PageId
  label: string
  group: GroupId
  /** One line under the title. */
  description: string
  /** The config.json key this page writes, shown in the header; null when none. */
  configKey: string | null
}

export const PAGES: readonly PageDef[] = [
  {
    id: 'launcher',
    label: 'Launcher',
    group: 'core',
    description:
      'The prompt you summon. Every change applies live; config.json stays the source of truth.',
    configKey: 'hotkey · sigil · terminal',
  },
  {
    id: 'bar',
    label: 'Bar',
    group: 'core',
    description:
      'Replaces the macOS menu bar. Drag cells between zones; plugins and widgets join as soon as they are installed.',
    configKey: 'bar',
  },
  {
    id: 'quicklinks',
    label: 'Quicklinks',
    group: 'core',
    description:
      'Links open on Enter; a {query} in the URL makes it a quicklink with a trigger word.',
    configKey: 'links',
  },
  {
    id: 'colorpicker',
    label: 'Color picker',
    group: 'core',
    description: 'How `colorpicker` samples the screen.',
    configKey: 'colorLoupe',
  },
  {
    id: 'theme',
    label: 'Theme',
    group: 'rungs',
    description:
      'One palette rendered into everything: the app, the bar, and (with the rung on) your terminals and editors.',
    configKey: 'theme · appearance',
  },
  {
    id: 'desktop',
    label: 'Desktop',
    group: 'rungs',
    description:
      'Window tiling (AeroSpace) and borders (JankyBorders), preconfigured; the whole file is yours the moment you stop letting scuttler manage it.',
    configKey: 'desktop',
  },
  {
    id: 'machine',
    label: 'Machine',
    group: 'rungs',
    description:
      'macOS defaults with the shine scraped off, a manifest of every file scuttler writes outside its own config, adopt never overwrite, and a way back.',
    configKey: 'machine',
  },
  {
    id: 'agents',
    label: 'Agents',
    group: 'extend',
    description:
      'Your own agent CLIs: ask them from the prompt, watch their sessions, see their usage.',
    configKey: 'agents',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    group: 'extend',
    description:
      'Directories in ~/.config/scuttler/plugins/: a manifest, a Bun service, and a cell and panel on the scuttler kit.',
    configKey: 'plugins',
  },
  {
    id: 'widgets',
    label: 'Widgets',
    group: 'extend',
    description:
      'Executables in ~/.config/scuttler/widgets/ that answer manifest and tick: any language, live, no restart.',
    configKey: 'widgets',
  },
  {
    id: 'updates',
    label: 'Updates',
    group: 'scuttler',
    description: 'How scuttler finds out about a newer scuttler.',
    configKey: 'updates',
  },
  {
    id: 'about',
    label: 'About',
    group: 'scuttler',
    description: 'The keyboard control surface for macOS.',
    configKey: null,
  },
]

/** Tab ids from before the redesign: `open_settings { tab }` callers and old
 * hashes still land somewhere sensible. */
const LEGACY: Record<string, PageId> = {
  general: 'launcher',
  menubar: 'bar',
}

const isPageId = (id: string): id is PageId => PAGES.some((p) => p.id === id)

/** `#desktop` → 'desktop'; a legacy id maps; anything else is the first page. */
export function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#/, '')
  if (isPageId(id)) return id
  return LEGACY[id] ?? 'launcher'
}

export function pageDef(id: PageId): PageDef {
  // infallible: every PageId has an entry (pinned by pages.test.ts)
  return PAGES.find((p) => p.id === id)!
}

/** Just the keys rung state reads, so the shell can pass the whole config. */
export type RungInputs = {
  appearance?: { everywhere?: boolean } | null
  desktop?: { tiling?: { enabled?: boolean } } | null
  machine?: { enabled?: boolean } | null
}

/** The rungs' on/off for the sidebar; null for pages that are not rungs. */
export function rungState(id: PageId, c: RungInputs): 'on' | 'off' | null {
  switch (id) {
    case 'theme':
      return c.appearance?.everywhere ? 'on' : 'off'
    case 'desktop':
      return c.desktop?.tiling?.enabled ? 'on' : 'off'
    case 'machine':
      return c.machine?.enabled ? 'on' : 'off'
    default:
      return null
  }
}

export type SearchEntry = {
  page: PageId
  section: string
  /** Exactly the row's label on the page: it is also the row's anchor. */
  label: string
  hint?: string
  /** Words a person might type that the label doesn't contain. */
  terms?: readonly string[]
}

/** Every row search can land on. Labels must match the rendered rows'. */
export const SEARCH_INDEX: readonly SearchEntry[] = [
  // Launcher
  {
    page: 'launcher',
    section: 'Summon',
    label: 'Summon hotkey',
    hint: 'Opens the prompt from anywhere.',
    terms: ['shortcut', 'keybinding', 'alt space'],
  },
  {
    page: 'launcher',
    section: 'Summon',
    label: 'Launch at login',
    terms: ['startup', 'login item'],
  },
  {
    page: 'launcher',
    section: 'Prompt',
    label: 'Prompt sigil',
    terms: ['glyph', 'cursor'],
  },
  {
    page: 'launcher',
    section: 'Prompt',
    label: 'Bang sigil',
    terms: ['bang mode', 'command'],
  },
  {
    page: 'launcher',
    section: 'Hand-off',
    label: 'Terminal',
    hint: 'Commands and bangs open here.',
    terms: ['ghostty', 'iterm2', 'terminal.app'],
  },
  {
    page: 'launcher',
    section: 'Hand-off',
    label: 'New window per command',
    terms: ['windows', 'tab'],
  },
  // Bar
  {
    page: 'bar',
    section: 'Bar',
    label: 'Enable the scuttler bar',
    terms: ['menubar', 'menu bar'],
  },
  {
    page: 'bar',
    section: 'Bar',
    label: 'Hide over fullscreen apps',
    terms: ['fullscreen', 'games', 'video'],
  },
  {
    page: 'bar',
    section: 'Layout',
    label: 'Zones',
    hint: 'Drag cells between the zones.',
    terms: ['widgets', 'cells', 'left', 'center', 'right', 'retire', 'layout'],
  },
  {
    page: 'bar',
    section: 'Layout',
    label: 'Separate arrangement for notched displays',
    terms: ['notch', 'camera'],
  },
  // Quicklinks
  {
    page: 'quicklinks',
    section: 'Links',
    label: 'Links',
    terms: ['quicklink', 'trigger', 'url', '{query}'],
  },
  {
    page: 'quicklinks',
    section: 'Search',
    label: 'Fallback search',
    hint: 'Opens when nothing matches.',
    terms: ['google', 'duckduckgo', 'web search'],
  },
  {
    page: 'quicklinks',
    section: 'Search',
    label: 'Index browser bookmarks',
    terms: ['bookmarks', 'chrome', 'safari'],
  },
  // Color picker
  {
    page: 'colorpicker',
    section: 'Sampler',
    label: 'Use the scuttler loupe',
    terms: ['colorpicker', 'screen recording', 'zoom', 'magnifier'],
  },
  // Theme
  {
    page: 'theme',
    section: 'Theme',
    label: 'Themes',
    terms: ['palette', 'colors', 'pick'],
  },
  {
    page: 'theme',
    section: 'Theme',
    label: 'Install from git',
    terms: ['omarchy', 'your themes', 'colors.toml', 'update installed'],
  },
  {
    page: 'theme',
    section: 'Policy',
    label: 'Mode',
    terms: ['light', 'dark', 'system', 'schedule', 'appearance'],
  },
  {
    page: 'theme',
    section: 'Policy',
    label: 'Pair',
    terms: ['light theme', 'dark theme'],
  },
  {
    page: 'theme',
    section: 'Focus',
    label: 'Focus modes',
    terms: ['focus', 'do not disturb', 'work'],
  },
  {
    page: 'theme',
    section: 'Everywhere',
    label:
      'Render this theme into Ghostty, tmux, the prompt, delta and Claude Code',
    terms: ['everywhere', 'rung', 'terminal'],
  },
  {
    page: 'theme',
    section: 'Everywhere',
    label: 'Also reload Ghostty’s config',
    terms: ['automation'],
  },
  {
    page: 'theme',
    section: 'Everywhere',
    label: 'Follow it with macOS light/dark',
    terms: ['appearance', 'dark mode'],
  },
  {
    page: 'theme',
    section: 'Everywhere',
    label: 'Also retint editors',
    terms: ['vs code', 'cursor', 'zed', 'neovim', 'helix', 'btop'],
  },
  // Desktop
  {
    page: 'desktop',
    section: 'Tiling',
    label: 'Tile windows with AeroSpace',
    terms: ['tiling', 'aerospace'],
  },
  {
    page: 'desktop',
    section: 'Tiling',
    label: 'Let scuttler manage AeroSpace',
    terms: ['aerospace.toml', 'config file', 'dotfiles'],
  },
  {
    page: 'desktop',
    section: 'Tiling',
    label: 'Modifier',
    terms: ['option', 'control', 'command', 'keys'],
  },
  {
    page: 'desktop',
    section: 'Tiling',
    label: 'Gaps',
    terms: ['padding', 'spacing'],
  },
  {
    page: 'desktop',
    section: 'Tiling',
    label: 'Workspaces',
    terms: ['spaces', 'desktops'],
  },
  {
    page: 'desktop',
    section: 'Borders',
    label: 'Draw a border around the focused window',
    terms: ['jankyborders', 'borders', 'width', 'style'],
  },
  {
    page: 'desktop',
    section: 'macOS',
    label: 'Override macOS’s window corner radius',
    terms: ['corners', 'radius', 'tahoe'],
  },
  // Machine
  {
    page: 'machine',
    section: 'Rung',
    label: 'Machine rung',
    terms: ['path', 'cli', 'migrations', 'enable'],
  },
  {
    page: 'machine',
    section: 'Setup',
    label: 'macOS defaults',
    terms: ['defaults', 'plan', 'apply', 'snapshot'],
  },
  {
    page: 'machine',
    section: 'Setup',
    label: 'Shell base',
    terms: ['zshrc', 'p10k', 'ghostty', 'tmux', 'git', 'shell'],
  },
  {
    page: 'machine',
    section: 'Setup',
    label: 'scuttler CLI',
    terms: ['link', 'unlink', 'path'],
  },
  {
    page: 'machine',
    section: 'Admin',
    label: 'Admin rule',
    terms: ['sudoers', 'sudo', 'mas', 'app store', 'awake', 'touch id'],
  },
  {
    page: 'machine',
    section: 'Doctor',
    label: 'Doctor',
    terms: ['diagnose', 'check'],
  },
  // Agents
  {
    page: 'agents',
    section: 'Ask',
    label: 'Enable agent mode',
    terms: ['?', 'ask', 'claude', 'codex', 'provider'],
  },
  {
    page: 'agents',
    section: 'Sessions',
    label: 'Enable local agent monitoring',
    terms: ['monitor', 'agents.sock', 'sessions'],
  },
  {
    page: 'agents',
    section: 'Sessions',
    label: 'Claude Code hooks',
    terms: ['hooks', 'settings.json'],
  },
  {
    page: 'agents',
    section: 'Sessions',
    label: 'Show idle sessions in the bar',
    terms: ['idle'],
  },
  {
    page: 'agents',
    section: 'Sessions',
    label: 'Forget sessions after',
    terms: ['prune', 'hours'],
  },
  {
    page: 'agents',
    section: 'Usage',
    label: 'Enable agent usage',
    terms: ['tokens', 'usage', 'limits'],
  },
  {
    page: 'agents',
    section: 'Usage',
    label: 'Claude credentials',
    terms: ['keychain', 'rate limit', 'accounts'],
  },
  {
    page: 'agents',
    section: 'Usage',
    label: 'Codex credentials',
    terms: ['auth.json'],
  },
  // Plugins / Widgets
  {
    page: 'plugins',
    section: 'Installed',
    label: 'Installed plugins',
    terms: ['plugin', 'bun', 'service', 'permissions'],
  },
  {
    page: 'plugins',
    section: 'Add',
    label: 'Install a plugin',
    terms: ['git', 'clone'],
  },
  {
    page: 'widgets',
    section: 'Installed',
    label: 'Installed widgets',
    terms: ['widget', 'tick', 'manifest', 'sign in', 'token'],
  },
  {
    page: 'widgets',
    section: 'Add',
    label: 'Install a widget',
    terms: ['url', 'file'],
  },
  // scuttler
  {
    page: 'updates',
    section: 'scuttler',
    label: 'Check for scuttler updates',
    terms: ['update', 'github releases', 'version'],
  },
  {
    page: 'about',
    section: 'Files',
    label: 'Config file',
    terms: ['config.json', 'edit', 'scripts folder'],
  },
]
