import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BarUsageCell } from './components'

/** Structural checks on the SSR markup for the usage cell. */
describe('BarUsageCell', () => {
  it('is a robot, not a meter, and dim before the first scan', () => {
    const html = renderToStaticMarkup(<BarUsageCell usage={null} nowSecs={0} />)

    expect(html).toContain('lucide-bot')
    expect(html).not.toContain('bar-usage-fill')
    expect(html).toContain('bar-pace-off')
  })
})
