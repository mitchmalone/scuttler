import { defineStories } from '@scuttler/tui'

import { ThemePanel } from './ThemePanel'

const noop = () => {}

export const themePanelStories = defineStories('ThemePanel (app)', [
  {
    name: 'system mode',
    keys: '↑↓ move · ⏎ apply · esc close · type to filter',
    render: () => (
      <ThemePanel
        current="scuttler"
        themes={{}}
        mode="system"
        dark={true}
        onPick={noop}
        onClose={noop}
      />
    ),
  },
  {
    name: 'a fixed dark mode, with a custom theme',
    render: () => (
      <ThemePanel
        current="dracula"
        themes={{ mine: { accent: '#ff79c6', bg: '#101014' } }}
        mode="dark"
        dark={false}
        onPick={noop}
        onClose={noop}
      />
    ),
  },
])
