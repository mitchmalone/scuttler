/**
 * The launcher's panel registry: which trigger words open a TUI panel inside the
 * launcher window, with the title, hint and fuzzy aliases each row shows. Pure
 * data, so the app (`panels/registry.ts`, which adds the component map and the
 * settings gates) and the site demo render one list (AGENTS invariant 10).
 * Plugin panels (`usage ⏎`, `updates ⏎`, …) are not here: a plugin's manifest
 * declares its own `panel` block (docs/PLUGINS.md) and joins at load time.
 */
export interface PanelInfo {
  id: string
  title: string
  hint: string
  /** Extra fuzzy-match words beyond the id (the deleted caffeinate slugs'
   * muscle memory lands on the awake panel through these). */
  aliases?: string[]
  /** Extra trigger words that open the panel outright (`ss ⏎`), beyond the id. */
  triggers?: string[]
}

export const PANEL_INFO: PanelInfo[] = [
  { id: 'agents', title: 'Agents', hint: 'coding agent sessions ▸' },
  {
    id: 'awake',
    title: 'Awake',
    hint: 'keep-alive sessions ▸',
    aliases: ['caffeine', 'caffeinate', 'keep-awake', 'stay-awake'],
  },
  { id: 'wifi', title: 'Wi-Fi', hint: 'networks & power ▸' },
  { id: 'dns', title: 'DNS', hint: 'network info ▸' },
  { id: 'audio', title: 'Audio', hint: 'volume & devices ▸' },
  { id: 'clipboard', title: 'Clipboard', hint: 'history & search ▸' },
  {
    id: 'screenshots',
    title: 'Screenshots',
    hint: 'latest captures ▸',
    aliases: ['ss', 'shots', 'capture', 'screen capture'],
    triggers: ['ss', 'shots'],
  },
  {
    id: 'aerospace',
    title: 'AeroSpace',
    hint: 'workspaces & tiling ▸',
    aliases: ['aero', 'tiling', 'workspace'],
  },
  {
    id: 'plugins',
    title: 'Plugins',
    hint: 'installed & gallery ▸',
    aliases: ['plugin', 'gallery', 'extensions'],
  },
  {
    id: 'theme',
    title: 'Theme',
    hint: 'pick a theme ▸',
    aliases: ['themes', 'appearance', 'colors', 'colours'],
  },
  { id: 'help', title: 'Help', hint: 'commands & keys ▸' },
  {
    id: 'setup',
    title: 'Setup',
    hint: 'hotkey, bar, agents, theme, tiling ▸',
    aliases: ['onboarding', 'welcome', 'first run', 'get started'],
  },
]

/** Trigger word → panel id, ids included, so `ss` and `screenshots` both open it. */
export const PANEL_TRIGGERS: Record<string, string> = Object.fromEntries(
  PANEL_INFO.flatMap((p) =>
    [p.id, ...(p.triggers ?? [])].map((t) => [t, p.id]),
  ),
)
