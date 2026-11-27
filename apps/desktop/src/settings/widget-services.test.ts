import type { WidgetServiceType } from '@scuttler/tui'
import { describe, expect, it } from 'vitest'

import {
  addService,
  nextServiceId,
  nextServiceLabel,
  serviceMissing,
  setServiceValue,
  updateService,
} from './widget-services'

const DAGU: WidgetServiceType = {
  type: 'dagu',
  name: 'Dagu',
  icon: 'workflow',
  settings: [
    { key: 'DAGU_URL', label: 'URL', required: true, secret: false },
    { key: 'DAGU_TOKEN', label: 'API key', required: true, secret: true },
    { key: 'DAGU_HIDE', label: 'Hide', required: false, secret: false },
  ],
  requires: [],
}

describe('widget services', () => {
  it('numbers a second service of a kind, in id and label', () => {
    const one = [{ id: 'dagu', type: 'dagu', label: 'Dagu', values: {} }]
    expect(nextServiceId([], 'dagu')).toBe('dagu')
    expect(nextServiceId(one, 'dagu')).toBe('dagu-2')
    expect(nextServiceId([...one, { ...one[0]!, id: 'dagu-2' }], 'dagu')).toBe(
      'dagu-3',
    )
    expect(nextServiceLabel(one, 'Dagu')).toBe('Dagu 2')
    expect(nextServiceLabel(one, 'Vercel')).toBe('Vercel')
  })

  it('adds at the end, keeps other widgets, and returns the new id', () => {
    const { map, id } = addService(
      { arr: [{ id: 'sonarr', type: 'sonarr', label: 'Sonarr', values: {} }] },
      'jobs',
      DAGU,
    )
    expect(id).toBe('dagu')
    expect(map.jobs).toEqual([
      { id: 'dagu', type: 'dagu', label: 'Dagu', values: {} },
    ])
    expect(map.arr).toHaveLength(1)
    const again = addService(map, 'jobs', DAGU)
    expect(again.map.jobs?.map((s) => s.id)).toEqual(['dagu', 'dagu-2'])
  })

  it('sets and clears values, and drops a widget with no services left', () => {
    const { map } = addService(undefined, 'jobs', DAGU)
    const set = setServiceValue(map, 'jobs', 'dagu', 'DAGU_URL', 'https://nas')
    expect(set.jobs?.[0]?.values).toEqual({ DAGU_URL: 'https://nas' })
    const cleared = setServiceValue(set, 'jobs', 'dagu', 'DAGU_URL', '')
    expect(cleared.jobs?.[0]?.values).toEqual({})
    expect(updateService(cleared, 'jobs', 'dagu', () => null)).toEqual({})
  })

  it('says what a service still needs, secrets by presence', () => {
    const svc = { id: 'dagu', type: 'dagu', label: 'Dagu', values: {} }
    expect(serviceMissing(DAGU, svc, [])).toEqual(['URL', 'API key'])
    expect(
      serviceMissing(DAGU, { ...svc, values: { DAGU_URL: 'u' } }, [
        'DAGU_TOKEN',
      ]),
    ).toEqual([])
    expect(serviceMissing(undefined, svc, [])).toEqual([])
  })
})
