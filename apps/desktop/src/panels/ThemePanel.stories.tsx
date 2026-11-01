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
        focusName={null}
        onPick={noop}
        onClose={noop}
      />
    ),
  },
  {
    name: 'in a Focus, with a custom theme',
    render: () => (
      <ThemePanel
        current="dracula"
        themes={{ mine: { accent: '#ff79c6', bg: '#101014' } }}
        mode="schedule"
        dark={false}
        focusName="Work"
        onPick={noop}
        onClose={noop}
      />
    ),
  },
])
