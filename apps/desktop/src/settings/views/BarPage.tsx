import { useState } from 'react'

import {
  type WidgetHome,
  normalizeBarZones,
  notchedZones,
} from '../../lib/config'
import { usePlugins } from '../../plugins/use-plugins'
import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Block, Page, Row, Section, Segmented, Toggle } from '../ui'
import { ZoneBoard } from './ZoneBoard'
import { PAGE_ICONS } from './icons'
import { useWidgets } from './widget-kit'

type Arrangement = 'standard' | 'notched'

/**
 * Settings → Bar: on/off, fullscreen, and the zone boards. The notched layout
 * is a switch between two boards rather than a second board underneath; it
 * exists only once "separate arrangement" is on.
 */
export function BarPage({ config, set }: PageProps) {
  const def = pageDef('bar')
  const widgets = useWidgets()
  const plugins = usePlugins(2000)
  const homes: WidgetHome[] = [
    ...widgets.map((w) => ({ id: w.id, zone: w.zone })),
    ...plugins
      .filter((p) => p.enabled && p.kinds.includes('bar-widget'))
      .map((p) => ({ id: p.id, zone: p.zone, kind: 'plugin' as const })),
  ]
  const layout = normalizeBarZones(config.bar.layout, homes)
  // Normalized + center-folded, so every module stays reachable on a board
  // that has no center column.
  const notched = config.bar.notchedLayout
    ? notchedZones(config.bar, homes)
    : null
  const [view, setView] = useArrangement(notched !== null)

  return (
    <Page
      icon={PAGE_ICONS.bar}
      title={def.label}
      description={def.description}
      configKey={def.configKey}
    >
      <Section>
        <Row
          label="Enable the scuttler bar"
          cfg="enabled"
          hint="Replaces the macOS menu bar with an Omarchy-style strip. Applies immediately."
        >
          <Toggle
            label="Enable the scuttler bar"
            checked={config.bar.enabled}
            onChange={(on) => set('bar', { ...config.bar, enabled: on })}
          />
        </Row>
        <Row
          label="Hide over fullscreen apps"
          cfg="hideOverFullscreen"
          hint="While the app in front covers a whole display (a game, a video), the bar on that display steps aside and returns when you switch away."
        >
          <Toggle
            label="Hide over fullscreen apps"
            checked={config.bar.hideOverFullscreen ?? true}
            onChange={(on) =>
              set('bar', { ...config.bar, hideOverFullscreen: on })
            }
          />
        </Row>
      </Section>

      <Section
        title="Layout"
        aside={
          notched && (
            <Segmented
              options={[
                { id: 'standard', label: 'standard' },
                { id: 'notched', label: 'notched' },
              ]}
              value={view}
              onChange={setView}
            />
          )
        }
      >
        <Block anchor="Zones">
          <p className="blk-hint">
            Drag cells between the zones; ✕ retires one to the tray, dragging it
            back restores it. Plugins and widgets join here as soon as they are
            installed.
          </p>
          {view === 'notched' && notched ? (
            <ZoneBoard
              zones={notched}
              zoneNames={['left', 'right']}
              widgets={widgets}
              onChange={(next) =>
                set('bar', { ...config.bar, notchedLayout: next })
              }
            />
          ) : (
            <ZoneBoard
              zones={layout}
              zoneNames={['left', 'center', 'right']}
              widgets={widgets}
              onChange={(next) => set('bar', { ...config.bar, layout: next })}
            />
          )}
        </Block>
        <Row
          label="Separate arrangement for notched displays"
          cfg="notchedLayout"
          hint="Notched displays have no center zone: the camera housing owns it. On, they get their own board, seeded from what they show today."
        >
          <Toggle
            label="Separate arrangement for notched displays"
            checked={notched !== null}
            onChange={(on) => {
              set('bar', {
                ...config.bar,
                // Seeded from what a notched display shows today (center
                // folded into right); off falls back to that derivation.
                notchedLayout: on ? notchedZones(config.bar, homes) : null,
              })
              setView(on ? 'notched' : 'standard')
            }}
          />
        </Row>
      </Section>
    </Page>
  )
}

/** Which board is showing; snaps back to standard when notched goes away. */
function useArrangement(
  hasNotched: boolean,
): [Arrangement, (a: Arrangement) => void] {
  const [view, setView] = useState<Arrangement>('standard')
  return [hasNotched ? view : 'standard', setView]
}
