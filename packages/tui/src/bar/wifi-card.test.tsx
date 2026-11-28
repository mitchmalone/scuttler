import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { BarWifiCard } from './components'

/** Structural checks on the SSR markup for the wifi card's head. */

const card = (props: {
  online: boolean
  ssid: string | null
  rssi: number | null
  kind?: string
  port?: string | null
}) => renderToStaticMarkup(<BarWifiCard detail={null} {...props} />)

const lit = (html: string) => html.match(/data-lit="true"/g)?.length ?? 0

describe('BarWifiCard', () => {
  it('names the network when macOS gives it up', () => {
    const html = card({ online: true, ssid: 'RamenAmok', rssi: -56 })

    expect(html).toContain('Connected to RamenAmok')
  })

  it('says only "Connected" when the name is withheld', () => {
    const html = card({ online: true, ssid: null, rssi: -56 })

    expect(html).toContain('>Connected<')
    expect(html).not.toContain('SSID hidden')
  })

  it('draws a signal meter where the subtitle was', () => {
    const html = card({ online: true, ssid: null, rssi: -56 })

    expect(html).not.toContain('bar-wifi-state')
    expect(html).toContain('bar-wifi-meter')
    expect(lit(html)).toBe(14)
    // The number is still there for a screen reader.
    expect(html).toContain('aria-label="Signal -56 dBm · excellent"')
  })

  it('warns on a poor link, as the cell does', () => {
    expect(card({ online: true, ssid: null, rssi: -84 })).toContain(
      'bar-wifi-meter-poor',
    )
    expect(card({ online: true, ssid: null, rssi: -56 })).not.toContain(
      'bar-wifi-meter-poor',
    )
  })

  it('leaves the meter dark offline', () => {
    const html = card({ online: false, ssid: null, rssi: null })

    expect(html).toContain('>Offline<')
    expect(lit(html)).toBe(0)
    expect(html).toContain('aria-label="No signal"')
  })

  it('names an Ethernet link by its adapter, with no signal meter', () => {
    const html = card({
      online: true,
      ssid: null,
      rssi: null,
      kind: 'ethernet',
      port: 'Belkin USB-C LAN',
    })

    expect(html).toContain('>Ethernet<')
    expect(html).toContain('Belkin USB-C LAN')
    expect(html).not.toContain('data-lit')
    expect(html).not.toContain('Offline')
  })
})
