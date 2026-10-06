import { describe, expect, it } from 'vitest'
import type { HaWeatherDisplay } from '../types/ha'
import { useHA } from './useHA'
import { state } from './useInverterState'

describe('useHA rich entity population', () => {
  it('starts with empty sections', () => {
    const { haSensors, haCovers, haScenes, haNumbers, haMediaPlayers, haWeather } = useHA()
    expect(haSensors.value).toEqual([])
    expect(haCovers.value).toEqual([])
    expect(haScenes.value).toEqual([])
    expect(haNumbers.value).toEqual([])
    expect(haMediaPlayers.value).toEqual([])
    expect(haWeather.value).toBeNull()
  })

  it('populates from state.ha_filtered and clears when it disappears', async () => {
    const ha = useHA()

    state.value = {
      ...state.value,
      ha_filtered: {
        sensors: [{ entity_id: 'sensor.t', name: 'T', state: '21', unit: '°C' }],
        covers: [{ entity_id: 'cover.b', name: 'B', position: 40 }],
        scenes: [{ entity_id: 'scene.m', name: 'M' }],
        numbers: [],
        media_players: [{ entity_id: 'media_player.s', name: 'S', state: 'playing' }],
        weather: {
          entity_id: 'weather.h',
          name: 'H',
          state: 'sunny',
          temperature: 20,
          unit: '°C',
          forecast: [],
        },
      },
    }
    await Promise.resolve()
    expect(ha.haSensors.value).toHaveLength(1)
    expect(ha.haCovers.value[0].position).toBe(40)
    expect((ha.haWeather.value as HaWeatherDisplay | null)?.temperature).toBe(20)

    // Backend stops sending (HA disconnected) → sections empty again
    const cleared = { ...state.value }
    delete cleared.ha_filtered
    state.value = cleared
    await Promise.resolve()
    expect(ha.haSensors.value).toEqual([])
    expect(ha.haCovers.value).toEqual([])
    expect(ha.haWeather.value).toBeNull()
  })
})

describe('appliance telemetry independent of legacy load names', () => {
  it('does not report idle when neither HA nor named load telemetry is available', () => {
    const ha = useHA()
    state.value = { loads: { Oven: 420 } }
    expect(ha.dishwasherRunning.value).toBeUndefined()
    expect(ha.washerRunning.value).toBeUndefined()
    expect(ha.dryerRunning.value).toBeUndefined()
    state.value = { loads: { dishwasher: 0, washer: 0, dryer: 0 } }
    expect(ha.dishwasherRunning.value).toBe(false)
    expect(ha.washerRunning.value).toBe(false)
    expect(ha.dryerRunning.value).toBe(false)
    ha.cleanupHa()
  })

  it('uses explicit HA states and timers without loads', () => {
    const ha = useHA()
    state.value = { dishwasher_running: true, washer_time: 120, dryer_time: 60 }
    expect(ha.dishwasherRunning.value).toBe(true)
    expect(ha.washerRunning.value).toBe(true)
    expect(ha.dryerRunning.value).toBe(true)
    state.value = {
      dishwasher_running: false,
      washer_time: 0,
      dryer_power: false,
      loads: { dishwasher: 100, washer: 100, dryer: 100 },
    }
    expect(ha.dishwasherRunning.value).toBe(false)
    expect(ha.washerRunning.value).toBe(false)
    expect(ha.dryerRunning.value).toBe(false)
  })
})


it('never invents Home entities or unavailable switch readings', () => {
  state.value = { ui_config: {} }
  const ha = useHA()
  expect(ha.homeButtons.value).toEqual([])
  state.value = {
    ui_config: { home_buttons: [
      { id: 'one', label: 'Configured only', entity: 'switch.explicit', state_key: 'chosen_state' },
      { id: 'two', label: 'Unknown', entity: 'light.second' },
    ] }, booleans: { chosen_state: 'on', home_two: null },
  }
  expect(ha.homeButtons.value.map((button) => button.entity)).toEqual(['switch.explicit', 'light.second'])
  expect(ha.buttonStates.value).toEqual({ one: 'on', two: 'unavailable' })
  state.value = { ...state.value, ui_config: { home_buttons: [] } }
  expect(ha.homeButtons.value).toEqual([])
  ha.cleanupHa()
})

it('accepts legacy appliance watts without treating standby or missing power as running', () => {
  const ha = useHA()
  state.value = { washer_power: 500, dryer_power: 0.5 }
  expect(ha.washerRunning.value).toBe(true)
  expect(ha.dryerRunning.value).toBe(false)
  state.value = { washer_power: Number.NaN, dryer_power: true }
  expect(ha.washerRunning.value).toBeUndefined()
  expect(ha.dryerRunning.value).toBe(true)
  ha.cleanupHa()
})

it('honors explicitly disabled configured Home entities without changing enabled order', () => {
  state.value = { ui_config: { home_buttons: [
    { id: 'disabled', entity: 'switch.disabled', label: 'Hidden', enabled: false },
    { id: 'enabled', entity: 'light.enabled', label: 'Visible', enabled: true },
  ] } }
  const ha = useHA()
  expect(ha.homeButtons.value.map(item => item.id)).toEqual(['enabled'])
  ha.cleanupHa()
})
