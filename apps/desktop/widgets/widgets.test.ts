import { describe, expect, it } from 'vitest'

import * as trmnl from './trmnl'
import * as uptime from './uptime'

/**
 * The reference widgets' pure halves (docs/WIDGETS.md). Each `view` turns a
 * payload into a WidgetView; the network/credential halves stay untested here
 * and are proven by running `<widget> tick` by hand.
 */

const NOW = Date.parse('2026-08-19T12:00:00Z')

describe('uptime', () => {
  const PAGE = 'https://kuma.example/status/home'
  const page = {
    publicGroupList: [
      {
        name: 'Sites',
        monitorList: [
          { id: 1, name: 'a', url: 'https://a' },
          { id: 2, name: 'b' },
        ],
      },
    ],
  }

  it('reads the origin and slug from the status page address', () => {
    expect(uptime.parsePage('https://k.example:8444/status/status')).toEqual({
      origin: 'https://k.example:8444',
      slug: 'status',
      page: 'https://k.example:8444/status/status',
    })
    expect(uptime.parsePage('https://k.example/')?.slug).toBe('default')
    expect(uptime.parsePage('k.example')).toBeNull()
    expect(uptime.parsePage(undefined)).toBeNull()
    expect(uptime.manifest().settings[0]).toMatchObject({ required: true })
  })

  it('is quiet with no label while everything is up', () => {
    const v = uptime.view(
      page,
      {
        heartbeatList: {
          '1': [
            { status: 0, ping: null },
            { status: 1, ping: 200.4 },
          ],
          '2': [{ status: 1, ping: 300 }],
        },
        uptimeList: { '1_24': 0.9991, '2_24': 1 },
      },
      PAGE,
    )
    expect(v).toMatchObject({ tone: 'ok', icon: 'arrow-big-up', label: null })
    expect(v.click).toEqual({ type: 'open', value: PAGE })
    expect(v.card?.subtitle).toBe('all 2 up')
    // The latest beat is the last one; a shared URL opens the site.
    expect(v.card?.rows?.[0]).toMatchObject({
      dot: 'ok',
      text: 'a',
      hint: '99.91% · 200 ms',
      action: { type: 'open', value: 'https://a' },
    })
    // No shared URL: the row opens the status page.
    expect(v.card?.rows?.[1]).toMatchObject({
      hint: '100% · 300 ms',
      action: { type: 'open', value: PAGE },
    })
  })

  it('counts the down monitors on the cell and marks their rows', () => {
    const v = uptime.view(
      page,
      {
        heartbeatList: { '1': [{ status: 1, ping: 1 }], '2': [{ status: 0 }] },
        uptimeList: { '2_24': 0.5 },
      },
      PAGE,
    )
    expect(v).toMatchObject({
      tone: 'error',
      icon: 'arrow-big-down',
      label: '1',
    })
    expect(v.card?.subtitle).toBe('1 of 2 down')
    expect(v.card?.rows?.[1]).toMatchObject({
      dot: 'error',
      hint: 'down · 50.0%',
    })
  })

  it('tells pending, maintenance and no data apart from down', () => {
    const v = uptime.view(
      {
        publicGroupList: [
          {
            name: 'g',
            monitorList: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        ],
      },
      { heartbeatList: { '1': [{ status: 2 }], '2': [{ status: 3 }] } },
      PAGE,
    )
    expect(v.tone).toBe('ok')
    expect(v.card?.rows?.map((r) => [r.dot, r.hint])).toEqual([
      ['warn', 'pending'],
      ['muted', 'maintenance'],
      ['muted', 'no data'],
    ])
  })

  it('keeps group names when the page has several', () => {
    const v = uptime.view(
      {
        publicGroupList: [
          { name: 'Sites', monitorList: [{ id: 1, name: 'a' }] },
          { name: 'Empty', monitorList: [] },
          { name: 'Home', monitorList: [{ id: 2, name: 'nas' }] },
        ],
      },
      {},
      PAGE,
    )
    expect(v.card?.rows).toBeUndefined()
    expect(v.card?.sections?.map((s) => s.title)).toEqual(['Sites', 'Home'])
    expect(uptime.view({}, {}, PAGE).card?.subtitle).toBe(
      'no monitors on the page',
    )
  })

  it('never rounds a miss up to 100%', () => {
    expect(uptime.uptimePct(1)).toBe('100%')
    expect(uptime.uptimePct(0.99999)).toBe('99.99%')
    expect(uptime.uptimePct(0.9825)).toBe('98.3%')
    expect(uptime.uptimePct(0.9996)).toBe('99.96%')
    expect(uptime.uptimePct(undefined)).toBeNull()
  })
})

describe('trmnl', () => {
  it('tones by the lowest device and prints the number only in the red tier', () => {
    const v = trmnl.view(
      [
        { name: 'Desk', percent_charged: 87.4, battery_voltage: 4.1 },
        {
          name: 'Kitchen',
          percent_charged: 12,
          hardware_last_ping_at: '2026-08-19T11:50:00Z',
        },
      ],
      NOW,
    )
    expect(v).toMatchObject({ tone: 'error', label: '12%', icon: 'tablet' })
    expect(v.card?.subtitle).toBe('2 devices')
    expect(v.card?.rows?.[0]).toMatchObject({
      dot: 'ok',
      text: 'Desk · 87%',
      hint: '4.1V',
    })
    expect(v.card?.rows?.[1]).toMatchObject({
      dot: 'error',
      text: 'Kitchen · 12%',
      hint: '10m ago',
    })
  })

  it('is amber at 40 % and muted with no readings', () => {
    expect(trmnl.tone(40)).toBe('warn')
    expect(trmnl.tone(41)).toBe('ok')
    const v = trmnl.view([{ name: 'x' }], NOW)
    expect(v.tone).toBe('muted')
    expect(v.label).toBeNull()
    expect(v.card?.rows?.[0]?.text).toBe('x')
  })
})
