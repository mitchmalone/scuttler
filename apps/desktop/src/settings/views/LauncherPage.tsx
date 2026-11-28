import type { Config } from '../../lib/config'
import HotkeyRecorder from '../HotkeyRecorder'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Page, Row, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/** Settings → Launcher: summon, the prompt's two sigils, the terminal hand-off. */
export function LauncherPage({ config, set }: PageProps) {
  const def = pageDef('launcher')
  return (
    <Page
      icon={PAGE_ICONS.launcher}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
    >
      <Section title="Summon">
        <Row
          label="Summon hotkey"
          cfg="hotkey"
          hint="Opens the prompt from anywhere; Esc puts focus back exactly where it was. Click, then press a key combo."
        >
          <HotkeyRecorder
            value={config.hotkey}
            onChange={(accel) => accel && set('hotkey', accel)}
          />
        </Row>
        <Row
          label="Launch at login"
          cfg="launchAtLogin"
          hint="Starts hidden; the bar and the hotkey are ready as soon as you log in."
        >
          <Toggle
            label="Launch at login"
            checked={config.launchAtLogin}
            onChange={(on) => set('launchAtLogin', on)}
          />
        </Row>
      </Section>

      <Section title="Prompt">
        <Row
          label="Prompt sigil"
          cfg="sigil"
          hint="The glyph before the cursor."
        >
          <input
            className="tiny center"
            aria-label="Prompt sigil"
            value={config.sigil}
            onChange={(e) => set('sigil', e.target.value)}
          />
        </Row>
        <Row
          label="Bang sigil"
          cfg="bangSigil"
          hint="The first character that switches the prompt into bang mode: a shell command for your terminal."
        >
          <input
            className="tiny center"
            aria-label="Bang sigil"
            value={config.bangSigil}
            onChange={(e) => set('bangSigil', e.target.value)}
          />
        </Row>
      </Section>

      <Section title="Hand-off">
        <Row
          label="Terminal"
          cfg="terminal"
          hint="Commands and bangs open here. Ghostty needs no permission; iTerm2 and Terminal.app ask for Automation once."
        >
          <select
            aria-label="Terminal"
            value={config.terminal}
            onChange={(e) =>
              set('terminal', e.target.value as Config['terminal'])
            }
          >
            <option value="Ghostty">Ghostty</option>
            <option value="iTerm2">iTerm2</option>
            <option value="Terminal">Terminal.app</option>
          </select>
        </Row>
        <Row
          label="New window per command"
          cfg="bangNewWindow"
          hint="Off reuses the frontmost terminal window."
        >
          <Toggle
            label="New window per command"
            checked={config.bangNewWindow}
            onChange={(on) => set('bangNewWindow', on)}
          />
        </Row>
      </Section>
    </Page>
  )
}
