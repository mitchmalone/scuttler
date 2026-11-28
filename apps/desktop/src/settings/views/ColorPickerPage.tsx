import { pageDef } from '../pages'
import type { PageProps } from '../types'
import { Page, Row, Section, Toggle } from '../ui'
import { PAGE_ICONS } from './icons'

const ZOOMS = [2, 3, 4, 6, 8] as const
const SIZES = [176, 264, 352, 440, 528] as const

/** Settings → Color picker: Apple's sampler, or scuttler's loupe (Screen Recording). */
export function ColorPickerPage({ config, set }: PageProps) {
  const def = pageDef('colorpicker')
  return (
    <Page
      icon={PAGE_ICONS.colorpicker}
      title={def.label}
      description={
        <>
          How <code>colorpicker</code> samples the screen.
        </>
      }
      configKey={def.configKey}
    >
      <Section title="Sampler">
        <Row
          label="Use the scuttler loupe"
          cfg="colorLoupe"
          hint={
            <>
              Off (default): Apple&apos;s own sampler, no permission, its zoom.
              On: scuttler draws its own loupe, which needs{' '}
              <strong>Screen Recording</strong>. The first pick after switching
              asks macOS once; grant it, relaunch scuttler, and picks use the
              loupe. Flip back any time to compare.
            </>
          }
        >
          <Toggle
            label="Use the scuttler loupe"
            checked={config.colorLoupe}
            onChange={(on) => set('colorLoupe', on)}
          />
        </Row>
        {config.colorLoupe && (
          <>
            <Row label="Zoom" cfg="colorLoupeZoom">
              <select
                aria-label="Zoom"
                className="narrow"
                value={String(config.colorLoupeZoom)}
                onChange={(e) => set('colorLoupeZoom', Number(e.target.value))}
              >
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z}×
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Size" cfg="colorLoupeSize">
              <select
                aria-label="Size"
                className="narrow"
                value={String(config.colorLoupeSize)}
                onChange={(e) => set('colorLoupeSize', Number(e.target.value))}
              >
                {SIZES.map((d) => (
                  <option key={d} value={d}>
                    {d}px
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}
      </Section>
    </Page>
  )
}
