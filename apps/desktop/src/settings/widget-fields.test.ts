import type { WidgetSetting } from '@scuttler/tui'
import { describe, expect, it } from 'vitest'

import { shownFields } from './widget-fields'

const ARR: WidgetSetting[] = [
  { key: 'RADARR_URL', label: 'Radarr URL' },
  { key: 'RADARR_API_KEY', label: 'Radarr API key', secret: true },
  { key: 'SONARR_API_KEY', label: 'Sonarr API key', secret: true },
]
const VERCEL: WidgetSetting[] = [
  { key: 'VERCEL_TOKEN', label: 'Vercel', secret: true },
]

describe('shownFields', () => {
  it('shows every field of a widget with no CLI to fall back on, healthy or not', () => {
    const set = new Set(['RADARR_URL'])
    expect(
      shownFields(ARR, {
        selfServe: false,
        attention: false,
        isSet: (s) => set.has(s.key),
      }),
    ).toEqual(['RADARR_URL', 'RADARR_API_KEY', 'SONARR_API_KEY'])
  })

  it('hides an empty optional token while a CLI-backed widget is healthy', () => {
    expect(
      shownFields(VERCEL, {
        selfServe: true,
        attention: false,
        isSet: () => false,
      }),
    ).toEqual([])
  })

  it('brings it back when the widget needs the user or the token is set', () => {
    expect(
      shownFields(VERCEL, {
        selfServe: true,
        attention: true,
        isSet: () => false,
      }),
    ).toEqual(['VERCEL_TOKEN'])
    expect(
      shownFields(VERCEL, {
        selfServe: true,
        attention: false,
        isSet: () => true,
      }),
    ).toEqual(['VERCEL_TOKEN'])
  })
})
