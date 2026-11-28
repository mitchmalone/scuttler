import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Page, Row, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

/** Settings → Updates: the self-update check (invariant 12: off makes no request). */
export function UpdatesPage({ config, set }: PageProps) {
  const def = pageDef('updates')
  return (
    <Page
      icon={PAGE_ICONS.updates}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
    >
      <Section title="scuttler">
        <Row
          label="Check for scuttler updates"
          cfg="checkSelf"
          hint={
            <>
              Every 6 h, from GitHub Releases; the newest shows in{' '}
              <code>updates ⏎</code>, where ↵ installs it and relaunches.
              Nothing about you is sent. Off means the request is never made.
            </>
          }
        >
          <Toggle
            label="Check for scuttler updates"
            checked={config.updates?.checkSelf ?? true}
            onChange={(on) => set('updates', { checkSelf: on })}
          />
        </Row>
      </Section>
    </Page>
  )
}
