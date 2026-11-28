import { describe, expect, it } from 'vitest'

import {
  adjustedPct,
  agentAge,
  agentCrumbs,
  agentDoing,
  agentDuration,
  agentLocation,
  agentMeta,
  agentStateLabel,
  batteryLook,
  batteryState,
  contextTone,
  formatBarClock,
  groupAgents,
  networkKind,
  networkTitle,
  networkTone,
  sessionCardHeight,
  sessionCounts,
  sessionHoverKey,
  sessionTiles,
  tileAge,
  tileName,
  tileStatus,
  timeLeft,
  toneClass,
  widgetHealth,
  widgetToneClass,
  wifiBars,
  wifiMeterLit,
  wifiSignalLabel,
  wifiTitle,
  wifiTone,
} from './format'
import type { AgentSession, BatteryDetail } from './types'

const agent = (over: Partial<AgentSession> = {}): AgentSession => ({
  session: 's1',
  agent: 'claude',
  state: 'idle',
  title: '',
  detail: '',
  mux: '',
  muxTarget: '',
  updatedAt: 0,
  muxGroup: null,
  muxIndex: null,
  muxLabel: null,
  pid: null,
  pidComm: null,
  startedAt: 0,
  stateSince: 0,
  ...over,
})

const battery = (over: Partial<BatteryDetail> = {}): BatteryDetail => ({
  pct: 64,
  onAc: false,
  charging: false,
  fullyCharged: false,
  chargeLimit: null,
  cycleCount: null,
  capacityWh: null,
  designWh: null,
  healthPct: null,
  minutesRemaining: null,
  batteryWatts: null,
  systemWatts: null,
  powerMode: null,
  ...over,
})

describe('agent state presentation', () => {
  it('relabels the wire states that read wrong, passes others through', () => {
    // `attention` is the wire name; "needs you" is what a human should read.
    expect(agentStateLabel('attention')).toBe('needs you')
    expect(agentStateLabel('done')).toBe('done · unread')
    expect(agentStateLabel('read')).toBe('done · read')
    expect(agentStateLabel('working')).toBe('working')
  })
})

describe('agentDoing', () => {
  it('turns a `Tool object` detail into an icon, a verb and the object', () => {
    expect(agentDoing('working', 'Edit format.ts')).toEqual({
      icon: 'pencil',
      verb: 'editing',
      object: 'format.ts',
    })
    expect(agentDoing('working', 'Bash pnpm verify')).toEqual({
      icon: 'terminal',
      verb: 'running',
      object: 'pnpm verify',
    })
  })

  it('speaks in the past once the agent is quiet', () => {
    expect(agentDoing('done', 'Bash pnpm verify')?.verb).toBe('last ran')
    expect(agentDoing('read', 'Edit a.ts')?.verb).toBe('last edited')
    expect(agentDoing('idle', 'Read a.ts')?.verb).toBe('last read')
  })

  it('has shapes for permission and thinking', () => {
    expect(
      agentDoing('attention', 'permission Bash scripts/release.sh'),
    ).toEqual({
      icon: 'lock',
      verb: 'permission',
      object: 'Bash scripts/release.sh',
    })
    expect(agentDoing('working', 'thinking')).toEqual({
      icon: 'brain',
      verb: 'thinking',
      object: '',
    })
  })

  it('reads the legacy `Event · Tool` detail and drops bare event names', () => {
    expect(agentDoing('working', 'PostToolUse · Edit')).toEqual({
      icon: 'pencil',
      verb: 'editing',
      object: '',
    })
    expect(agentDoing('idle', 'SessionStart')).toBeNull()
    expect(agentDoing('working', '')).toBeNull()
  })

  it('shows unknown text as it came, without an icon', () => {
    expect(agentDoing('working', 'waiting for a task')).toEqual({
      icon: null,
      verb: '',
      object: 'waiting for a task',
    })
  })
})

describe('agentDuration', () => {
  it('uses the two largest units', () => {
    expect(agentDuration(42)).toBe('42s')
    expect(agentDuration(160)).toBe('2m 40s')
    expect(agentDuration(4320)).toBe('1h 12m')
    expect(agentDuration(2 * 86_400 + 3 * 3600 + 59)).toBe('2d 3h')
    expect(agentDuration(-5)).toBe('0s')
  })
})

describe('agentMeta', () => {
  const now = 1_000_000
  it('names the clock after the state, then the session age and agent', () => {
    const a = agent({
      state: 'working',
      stateSince: now - 160,
      startedAt: now - 4320,
    })
    expect(agentMeta(a, now)).toEqual([
      'turn 2m 40s',
      'session 1h 12m',
      'claude',
    ])
    expect(agentMeta({ ...a, state: 'attention' }, now)[0]).toBe(
      'waiting 2m 40s',
    )
    expect(agentMeta({ ...a, state: 'done' }, now)[0]).toBe(
      'finished 2m 40s ago',
    )
    expect(agentMeta({ ...a, state: 'idle' }, now)[0]).toBe('idle 2m 40s')
  })

  it('falls back to the last event for records without clocks', () => {
    const a = agent({
      state: 'idle',
      updatedAt: now - 60,
      stateSince: 0,
      startedAt: 0,
    })
    expect(agentMeta(a, now)).toEqual(['idle 1m 0s', 'session 1m 0s', 'claude'])
  })
})

describe('agentAge', () => {
  const now = new Date(1_000_000 * 1000)
  const at = (secondsAgo: number) => agentAge(1_000_000 - secondsAgo, now)

  it('formats seconds, then rounded minutes, hours, days', () => {
    expect(at(0)).toBe('0s')
    expect(at(59)).toBe('59s')
    expect(at(60)).toBe('1m')
    expect(at(3599)).toBe('60m')
    expect(at(3600)).toBe('1h')
    expect(at(7000)).toBe('2h')
    expect(at(86_400)).toBe('1d')
    expect(at(3 * 86_400 + 3600)).toBe('3d')
  })

  it('clamps a future timestamp to zero rather than printing negatives', () => {
    expect(at(-500)).toBe('0s')
  })
})

describe('agentCrumbs', () => {
  it('splits the location into session, tab, window', () => {
    expect(
      agentCrumbs(
        agent({ muxGroup: 'psyke', muxIndex: 4, muxLabel: 'GeoProviders' }),
      ),
    ).toEqual(['psyke', 'tab 4', 'GeoProviders'])
    expect(agentCrumbs(agent({ muxGroup: null, mux: '' }))).toEqual([
      'outside a multiplexer',
    ])
  })
})

describe('agentLocation', () => {
  it('renders session, tab, and window name when present', () => {
    expect(
      agentLocation(
        agent({
          muxGroup: 'fable',
          muxIndex: 2,
          muxLabel: 'release',
        }),
      ),
    ).toBe('fable · tab 2 · release')
  })

  it('omits the window name when it is empty', () => {
    expect(
      agentLocation(agent({ muxGroup: 'www', muxIndex: 1, muxLabel: '' })),
    ).toBe('www · tab 1')
  })

  it('says so when the agent has no pane', () => {
    expect(agentLocation(agent())).toBe('outside a multiplexer')
  })
})

describe('groupAgents', () => {
  it('groups by tmux session name, ordering groups alphabetically', () => {
    const { groups } = groupAgents([
      agent({ session: 'b', muxGroup: 'www', muxIndex: 1 }),
      agent({ session: 'a', muxGroup: 'fable', muxIndex: 1 }),
    ])
    expect(groups.map(([name]) => name)).toEqual(['fable', 'www'])
  })

  it('orders cells within a group by tab index, not arrival order', () => {
    const { groups } = groupAgents([
      agent({ session: 'late', muxGroup: 'fable', muxIndex: 3 }),
      agent({ session: 'early', muxGroup: 'fable', muxIndex: 1 }),
    ])
    expect(groups[0]![1].map((a) => a.session)).toEqual(['early', 'late'])
  })

  it('breaks equal tab indexes on session id so order is stable', () => {
    const { groups } = groupAgents([
      agent({ session: 'z', muxGroup: 'fable', muxIndex: 1 }),
      agent({ session: 'a', muxGroup: 'fable', muxIndex: 1 }),
    ])
    expect(groups[0]![1].map((a) => a.session)).toEqual(['a', 'z'])
  })

  it('keeps agents outside tmux as loose cells, sorted by session', () => {
    const { groups, loose } = groupAgents([
      agent({ session: 'z' }),
      agent({ session: 'a' }),
    ])
    expect(groups).toEqual([])
    expect(loose.map((a) => a.session)).toEqual(['a', 'z'])
  })
})

describe('formatBarClock', () => {
  it('renders sketchybar parity with zero-padded 24h time', () => {
    // 2026-08-16 is a Sunday; 07:45 local.
    expect(formatBarClock(new Date(2026, 7, 16, 7, 45))).toBe(
      'Sun 16 Aug 07:45',
    )
  })
})

describe('timeLeft', () => {
  it('drops the hour part below an hour', () => {
    expect(timeLeft(58)).toBe('58m')
  })

  it('splits hours and minutes above one', () => {
    expect(timeLeft(298)).toBe('4h 58m')
    expect(timeLeft(120)).toBe('2h 0m')
  })
})

describe('batteryState', () => {
  it('reports charging over every other condition', () => {
    expect(batteryState(battery({ charging: true, onAc: true }))).toBe(
      'charging',
    )
  })

  it('distinguishes charged from plugged-in-but-idle', () => {
    expect(batteryState(battery({ onAc: true, fullyCharged: true }))).toBe(
      'charged',
    )
    expect(batteryState(battery({ onAc: true }))).toBe(
      'AC attached · not charging',
    )
  })

  it('falls through to discharging on battery', () => {
    expect(batteryState(battery())).toBe('discharging')
  })
})

describe('adjusted charge', () => {
  it('treats the charge limit as full, and no limit as identity', () => {
    expect(adjustedPct(80, 80)).toBe(100)
    expect(adjustedPct(40, 80)).toBe(50)
    expect(adjustedPct(64, null)).toBe(64)
    expect(adjustedPct(64, 100)).toBe(64)
    expect(adjustedPct(85, 80)).toBe(100)
  })
})

describe('battery look', () => {
  it('draws the level tiers from the adjusted charge', () => {
    expect(batteryLook(80, false, 80)).toMatchObject({
      glyph: 'full',
      tone: 'good',
      showPct: false,
    })
    expect(batteryLook(64, false, null)).toMatchObject({
      glyph: 'full',
      tone: 'good',
    })
    expect(batteryLook(45, false, null)).toMatchObject({
      glyph: 'medium',
      tone: 'warn',
    })
    expect(batteryLook(20, false, null)).toMatchObject({
      glyph: 'low',
      tone: 'warn',
    })
    expect(batteryLook(9, false, null)).toMatchObject({
      glyph: 'warning',
      tone: 'danger',
      showPct: true,
    })
  })

  it('goes blue while charging: level glyph below 90 %, charging glyph from 90 %', () => {
    expect(batteryLook(30, true, null)).toMatchObject({
      glyph: 'medium',
      tone: 'charging',
    })
    expect(batteryLook(95, true, null)).toMatchObject({
      glyph: 'charging',
      tone: 'charging',
    })
    // 75 % on an 80 % limit is 94 % adjusted.
    expect(batteryLook(75, true, 80)).toMatchObject({
      glyph: 'charging',
      adjusted: 94,
    })
  })

  it('reads plugged-in-but-held ("AC attached; not charging") as charging', () => {
    expect(batteryLook(80, false, 80, true)).toMatchObject({
      glyph: 'charging',
      tone: 'charging',
    })
    expect(batteryLook(80, false, 80, false)).toMatchObject({ tone: 'good' })
  })
})

describe('cell tones', () => {
  it('emits classes the CSS actually scopes under .bar-right', () => {
    expect(toneClass('normal')).toBe('bar-cell')
    expect(toneClass('warn')).toBe('bar-cell bar-warn')
    expect(toneClass('danger')).toBe('bar-cell bar-danger')
  })
})

describe('wifiTone', () => {
  it('offline is danger, poor is warn, fair and up plain', () => {
    expect(wifiTone(false, -40)).toBe('danger')
    expect(wifiTone(true, -85)).toBe('warn')
    expect(wifiTone(true, -75)).toBe('normal')
    expect(wifiTone(true, -50)).toBe('normal')
    expect(wifiTone(true, null)).toBe('normal')
  })
})

describe('wifi strength', () => {
  it('maps RSSI to bars, unknown to full', () => {
    expect(wifiBars(null)).toBe(4)
    expect(wifiBars(-45)).toBe(4)
    expect(wifiBars(-60)).toBe(4)
    expect(wifiBars(-61)).toBe(3)
    expect(wifiBars(-70)).toBe(3)
    expect(wifiBars(-75)).toBe(2)
    expect(wifiBars(-81)).toBe(1)
  })
  it('labels the card line', () => {
    expect(wifiSignalLabel(null)).toBe('')
    expect(wifiSignalLabel(-66)).toBe('-66 dBm · good')
    expect(wifiSignalLabel(-85)).toBe('-85 dBm · poor')
  })
  it('titles the card by what is known, never "hidden"', () => {
    // macOS withholds the name without Location Services; that is not a
    // hidden network, so the card just says it is connected.
    expect(wifiTitle(true, 'RamenAmok')).toBe('Connected to RamenAmok')
    expect(wifiTitle(true, null)).toBe('Connected')
    expect(wifiTitle(false, null)).toBe('Wi-Fi offline')
    expect(wifiTitle(false, 'RamenAmok')).toBe('Wi-Fi offline')
  })
  it('lights the meter so each quarter is one bar of the glyph', () => {
    expect(wifiMeterLit(-95, 16)).toBe(1)
    expect(wifiMeterLit(-81, 16)).toBe(4)
    expect(wifiMeterLit(-80, 16)).toBe(5)
    expect(wifiMeterLit(-70, 16)).toBe(9)
    expect(wifiMeterLit(-60, 16)).toBe(13)
    expect(wifiMeterLit(-56, 16)).toBe(14)
    expect(wifiMeterLit(-50, 16)).toBe(16)
    expect(wifiMeterLit(-30, 16)).toBe(16)
    for (const rssi of [-95, -85, -80, -75, -70, -65, -60, -40]) {
      expect(Math.ceil(wifiMeterLit(rssi, 16) / 4)).toBe(wifiBars(rssi))
    }
  })
  it('leaves the meter dark when the strength is unknown', () => {
    expect(wifiMeterLit(null, 16)).toBe(0)
  })
})

describe('widgets', () => {
  it('maps known tones to classes and ignores the rest', () => {
    expect(widgetToneClass('ok')).toBe('bar-tone-ok')
    expect(widgetToneClass('error')).toBe('bar-tone-error')
    expect(widgetToneClass('purple')).toBe('')
    expect(widgetToneClass(null)).toBe('')
  })

  it('describes health only when failing', () => {
    const now = new Date(1_000_000 * 1000)
    expect(widgetHealth(null, 999_000, now)).toBeNull()
    expect(widgetHealth('timed out after 10s', null, now)).toBe(
      'timed out after 10s',
    )
    expect(widgetHealth('exit 1: boom', 1_000_000 - 180, now)).toBe(
      'exit 1: boom · last ok 3m ago',
    )
  })
})

describe('session card', () => {
  it('keys a box by its group, the loose box by nothing', () => {
    expect(sessionHoverKey('gogogo')).toBe('agents:gogogo')
    expect(sessionHoverKey(null)).toBe('agents:')
  })

  it('counts with what needs you first, read folded into idle', () => {
    expect(
      sessionCounts([
        agent({ state: 'working' }),
        agent({ state: 'idle' }),
        agent({ state: 'attention' }),
        agent({ state: 'read' }),
        agent({ state: 'working' }),
        agent({ state: 'mystery' }),
      ]),
    ).toEqual(['1 needs you', '2 working', '2 idle', '1 other'])
    expect(sessionCounts([])).toEqual([])
  })

  it('names a tile by the session, not the prompt', () => {
    expect(
      tileName(
        agent({ name: 'Scuttler', muxLabel: 'main', title: 'Looks like…' }),
      ),
    ).toBe('Scuttler')
    expect(tileName(agent({ name: ' ', muxLabel: 'release' }))).toBe('release')
    expect(tileName(agent({ agent: 'codex' }))).toBe('codex')
  })

  it('says what a tile is doing in one line', () => {
    expect(
      tileStatus(agent({ state: 'working', detail: 'Edit agents.rs' })),
    ).toBe('editing agents.rs')
    expect(tileStatus(agent({ state: 'working', detail: '' }))).toBe('working')
    expect(
      tileStatus(agent({ state: 'attention', detail: 'allow Bash?' })),
    ).toBe('allow Bash?')
    expect(tileStatus(agent({ state: 'attention' }))).toBe('needs you')
    expect(tileStatus(agent({ state: 'done' }))).toBe('done, unread')
    expect(tileStatus(agent({ state: 'read' }))).toBe('done')
    expect(tileStatus(agent({ state: 'idle' }))).toBe('idle')
  })

  it('ages a tile by how long its state has held', () => {
    const now = new Date(1_000_000 * 1000)
    expect(
      tileAge(agent({ stateSince: 1_000_000 - 240, updatedAt: 1 }), now),
    ).toBe('4m')
    expect(
      tileAge(agent({ stateSince: 0, updatedAt: 1_000_000 - 7200 }), now),
    ).toBe('2h')
  })

  it('warms the context bar at 60 % and heats it at 80 %', () => {
    expect([10, 59, 60, 79, 80, 100].map(contextTone)).toEqual([
      '',
      '',
      'warm',
      'warm',
      'hot',
      'hot',
    ])
  })

  it('caps at 16 tiles, the last one standing for the rest', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => agent({ session: `s${i}` }))
    expect(sessionTiles(many(16))).toEqual({ tiles: many(16), more: 0 })
    const capped = sessionTiles(many(20))
    expect(capped.tiles).toHaveLength(15)
    expect(capped.more).toBe(5)
  })

  it('guesses the card height by rows', () => {
    expect(sessionCardHeight(1)).toBe(sessionCardHeight(4))
    expect(sessionCardHeight(5) - sessionCardHeight(4)).toBe(84)
    expect(sessionCardHeight(30)).toBe(sessionCardHeight(16))
  })
})

describe('network cell', () => {
  it('names what carries traffic; old payloads without a kind are Wi-Fi', () => {
    expect(networkKind(true, 'ethernet')).toBe('ethernet')
    expect(networkKind(true, 'tethered')).toBe('tethered')
    expect(networkKind(true, 'other')).toBe('other')
    expect(networkKind(true, 'wifi')).toBe('wifi')
    expect(networkKind(true, undefined)).toBe('wifi')
    expect(networkKind(false, 'ethernet')).toBe('offline')
  })

  it('titles the card by the link, and only offline alarms', () => {
    expect(networkTitle('ethernet', null)).toBe('Ethernet')
    expect(networkTitle('wifi', 'Home')).toBe('Connected to Home')
    expect(networkTitle('offline', null)).toBe('Offline')
    expect(networkTone('ethernet', null)).toBe('normal')
    expect(networkTone('offline', null)).toBe('danger')
    expect(networkTone('wifi', -85)).toBe('warn')
  })
})
