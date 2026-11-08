import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { PaletteError } from './palette.ts'
import { renderTheme } from './render.ts'
import { TemplateError } from './template.ts'

const MINIMAL = `
accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#a9b1d6"
red = "#f7768e"
yellow = "#e0af68"
green = "#9ece6a"
cyan = "#449dab"
blue = "#7aa2f7"
magenta = "#ad8ee6"
`

const FIXTURE =
  'name={{ name }} mode={{ mode }} bat={{ bat_theme }} bg={{ background }}\n'

const template = (file: string) =>
  readFileSync(
    fileURLToPath(new URL(`../templates/${file}`, import.meta.url)),
    'utf8',
  )
const GHOSTTY = template('ghostty.tpl')
const EDITOR_TEMPLATES = {
  'vscode-theme.json.tpl': template('vscode-theme.json.tpl'),
  'zed-theme.json.tpl': template('zed-theme.json.tpl'),
  'neovim.lua.tpl': template('neovim.lua.tpl'),
  'btop.theme.tpl': template('btop.theme.tpl'),
}

describe('renderTheme', () => {
  it('renders each template to its output name with name, mode and bat_theme', () => {
    const out = renderTheme({
      name: 'tokyo-night',
      text: MINIMAL,
      templates: { 'fixture.txt.tpl': FIXTURE },
    })
    expect(out.name).toBe('tokyo-night')
    expect(out.mode).toBe('dark')
    expect(out.files).toEqual({
      'fixture.txt': 'name=tokyo-night mode=dark bat=ansi bg=#1a1b26\n',
    })
    expect(out.tokens.bg).toBe('#1a1b26')
    expect(out.osc.startsWith('\x1b]10;#a9b1d6\x07')).toBe(true)
  })

  it('honours a top-level bat_theme and a [launcher] table', () => {
    const out = renderTheme({
      name: 'x',
      text: `${MINIMAL}\nbat_theme = "Solarized (dark)"\n[launcher]\nfg = "#ffffff"`,
      templates: { 'fixture.tpl': FIXTURE },
    })
    expect(out.files.fixture).toContain('bat=Solarized (dark)')
    expect(out.tokens.fg).toBe('#ffffff')
  })

  it('renders the real ghostty template', () => {
    const out = renderTheme({
      name: 'tokyo-night',
      text: MINIMAL,
      templates: { 'ghostty.tpl': GHOSTTY },
    })
    const ghostty = out.files.ghostty!
    expect(ghostty).toContain('# scuttler theme: tokyo-night')
    expect(ghostty).toContain('background = #1a1b26')
    expect(ghostty).toContain('palette = 9=#f991a5')
    expect(ghostty).toContain('palette = 15=#a9b1d6')
    expect(ghostty).not.toContain('{{')
  })

  it('lets a hand-written file with the same output name win verbatim', () => {
    const out = renderTheme({
      name: 'x',
      text: MINIMAL,
      templates: { 'ghostty.tpl': GHOSTTY, 'fixture.tpl': FIXTURE },
      handFiles: { ghostty: 'hand written\n' },
    })
    expect(out.files.ghostty).toBe('hand written\n')
    expect(out.files.fixture).toContain('name=x')
  })

  it('names the template on an unknown key', () => {
    const bad = () =>
      renderTheme({
        name: 'x',
        text: MINIMAL,
        templates: { 'broken.tpl': '{{ nope }}' },
      })
    expect(bad).toThrow(TemplateError)
    expect(bad).toThrow(/template broken\.tpl: unknown key: nope/)
    expect(() =>
      renderTheme({ name: 'x', text: MINIMAL, templates: { ghostty: 'x' } }),
    ).toThrow(/must end in \.tpl/)
  })

  it('renders the editor templates as valid output with no stray placeholders', () => {
    const out = renderTheme({
      name: 'tokyo-night',
      text: MINIMAL,
      templates: EDITOR_TEMPLATES,
    })
    for (const text of Object.values(out.files))
      expect(text).not.toContain('{{')
    const vscode = JSON.parse(out.files['vscode-theme.json']!)
    expect(vscode.name).toBe('scuttler — tokyo-night')
    expect(vscode.type).toBe('dark')
    expect(vscode.colors['editor.background']).toBe('#1a1b26')
    expect(vscode.tokenColors.length).toBeGreaterThan(10)
    const zed = JSON.parse(out.files['zed-theme.json']!)
    expect(zed.themes[0].name).toBe('scuttler')
    expect(zed.themes[0].appearance).toBe('dark')
    expect(zed.themes[0].style['editor.background']).toBe('#1a1b26')
    expect(zed.themes[0].style['terminal.ansi.red']).toBe('#f7768e')
    expect(zed.themes[0].style.players).toHaveLength(8)
    expect(out.files['neovim.lua']).toContain('colorscheme = "tokyonight"')
    expect(out.files['btop.theme']).toContain('theme[main_bg]="#1a1b26"')
    expect(out.editors).toEqual({
      vscode_theme: 'scuttler',
      neovim_colorscheme: 'tokyonight',
      helix_theme: 'tokyonight',
    })
  })

  it('exposes the editor names to templates and honours colors.toml overrides', () => {
    const out = renderTheme({
      name: 'x',
      text: `${MINIMAL}\nhelix_theme = "mine"\nmode = "light"`,
      templates: {
        'e.tpl':
          '{{ vscode_theme }} {{ neovim_colorscheme }} {{ helix_theme }}',
        'zed-theme.json.tpl': EDITOR_TEMPLATES['zed-theme.json.tpl'],
      },
    })
    expect(out.files.e).toBe('scuttler default mine')
    expect(JSON.parse(out.files['zed-theme.json']!).themes[0].appearance).toBe(
      'light',
    )
  })
})

describe('renderTheme refuses a palette that is not data', () => {
  // The readiness review's B2 (docs/reviews/2026-11-08-opensource-readiness.md):
  // rendered files are sourced by zsh, included by git and loaded by Neovim, so every
  // value must be a colour or a plain name before it reaches a template.
  const ALL = {
    'p10k-colors.zsh.tpl': template('p10k-colors.zsh.tpl'),
    'delta.gitconfig.tpl': template('delta.gitconfig.tpl'),
    'tmux.conf.tpl': template('tmux.conf.tpl'),
    ...EDITOR_TEMPLATES,
  }
  const attempt = (extra: string) => () =>
    renderTheme({ name: 'evil', text: MINIMAL + extra, templates: ALL })

  it('rejects a colour key that is not #rrggbb', () => {
    expect(attempt(`muted = "'; touch /tmp/pwned #"`)).toThrow(PaletteError)
    expect(attempt(`selection = "#fff"`)).toThrow(PaletteError)
    expect(attempt(`bright_magenta = "rgb(1,2,3)"`)).toThrow(PaletteError)
    expect(attempt(`muted = "#414868"`)).not.toThrow()
  })

  it('rejects a name key with anything beyond letters, digits, space, _ . - ( )', () => {
    expect(
      attempt(`bat_theme = "ansi\\n[core]\\n\\tpager = touch /tmp/x"`),
    ).toThrow(PaletteError)
    expect(
      attempt(`neovim_colorscheme = "default\\" } os.execute('x')"`),
    ).toThrow(PaletteError)
    expect(attempt(`helix_theme = "a;b"`)).toThrow(PaletteError)
    expect(
      attempt(`mode = "dark"\nbat_theme = "Solarized (dark)"`),
    ).not.toThrow()
  })

  it('rejects an unknown root key whose value is not a colour', () => {
    expect(attempt(`extra = "$(id)"`)).toThrow(PaletteError)
    expect(attempt(`extra = "#123456"`)).not.toThrow()
  })

  it('rejects a theme name that could break out of a quoted string', () => {
    expect(() =>
      renderTheme({
        name: `x" .. os.exit() .. "`,
        text: MINIMAL,
        templates: ALL,
      }),
    ).toThrow(PaletteError)
  })

  it('still renders every built-in theme', () => {
    const dir = fileURLToPath(new URL('../themes/', import.meta.url))
    for (const name of readdirSync(dir)) {
      const text = readFileSync(`${dir}${name}/colors.toml`, 'utf8')
      expect(
        () => renderTheme({ name, text, templates: ALL }),
        name,
      ).not.toThrow()
    }
  })
})
