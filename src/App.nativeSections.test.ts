import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import { useConnection } from './composables/useConnection'
import { mqttConnected, state } from './composables/useInverterState'
import { normalizeTelemetry } from './telemetry'
import { i18n } from './i18n'
import BatterySolarPanel from './components/BatterySolarPanel.vue'
import StatCards from './components/StatCards.vue'
import SidePanel from './components/SidePanel.vue'
import DailyStats from './components/DailyStats.vue'

const commands = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('./composables/useConnection', async () => {
  const shared = await import('./composables/useInverterState')
  const { ref } = await import('vue')
  const connection = {
    state: shared.state, mqttConnected: shared.mqttConnected, commandConnected: ref(true),
    commandError: ref(null), commandResult: ref(null),
    connectMqtt: vi.fn(), send: commands.send, cleanup: vi.fn(),
  }
  return { useConnection: () => connection }
})
vi.mock('./composables/useChart', () => ({ useChart: () => ({ chartOption: {}, forceUpdateChart: vi.fn() }) }))
vi.mock('./composables/useSystemNotifications', () => ({ initSystemNotifications: vi.fn() }))
vi.mock('./composables/useNotifications', () => ({ setNotificationCommandSender: vi.fn() }))
vi.mock('./composables/useTheme', () => ({ useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }) }))
vi.mock('./config/publicMode', () => ({ isPublicMode: () => false }))

let view: VueWrapper | undefined
function render() {
  view = mount(App, { global: {
    plugins: [i18n],
    stubs: { ChartPanel: true, CameraPopup: true, DailyStats: true, SettingsDrawer: true,
      NotificationBanner: true, NotificationHistory: true },
  } })
  return view
}
beforeEach(() => { state.value = {}; mqttConnected.value = true; commands.send.mockReset().mockReturnValue(true); useConnection().commandError.value = null; useConnection().commandResult.value = null; useConnection().commandConnected.value = true })
async function acceptLatest() {
  const [action, payload] = commands.send.mock.calls[commands.send.mock.calls.length - 1]
  useConnection().commandResult.value = { action, request_id: payload.request_id, status: 'accepted' }
  await nextTick()
}

afterEach(() => { view?.unmount(); view = undefined; vi.unstubAllGlobals() })

describe('native dashboard sections', () => {
  it('renders named loads including generation and small loads in desktop order', () => {
    state.value = {
      loads: { '1': -200, '2': 200, '3': 5, '4': 2, solar_shed: 20 },
      load_names: { '1': 'Roof solar', '2': 'Air conditioning', '3': 'Router' },
    }
    const wrapper = render()
    const rows = wrapper.findAll('[data-testid="active-load"]')
    expect(rows.map(row => row.findAll('span').map(span => span.text()))).toEqual([
      ['Air conditioning', '200W'], ['Roof solar', '-200W'], ['solar shed', '20W'], ['Router', '5W'],
    ])
    expect(rows[1].get('span:last-child').classes()).toContain('text-battery')
  })

  it('retains saved instance/name exclusions, explicit zero threshold and section visibility', async () => {
    state.value = {
      loads: { '1': 30, '2': 25, '3': 1, '4': 50 },
      load_names: { '1': 'Kitchen', '2': 'Water pump', '3': 'Standby', '4': 'Hidden' },
      ui_config: { loads: { hidden: ['1', 'water_pump', 'Hidden'], min_watts: 0 } },
    }
    const wrapper = render()
    expect(wrapper.get('[data-testid="active-load"]').findAll('span').map(span => span.text())).toEqual(['Standby', '1W'])
    expect(wrapper.findAll('[data-testid="active-load"]')).toHaveLength(1)
    state.value = { ...state.value, ui_config: { settings: { show_active_loads: false } } }
    await nextTick()
    expect(wrapper.find('[data-testid="active-loads"]').exists()).toBe(false)
  })

  it('honors daily and rich Home section visibility without hiding native measurements', async () => {
    state.value = { ui_config: { settings: { show_daily_stats: false, show_ha_covers: false, show_ha_sensors: false } } }
    const wrapper = render()
    expect(wrapper.findComponent(DailyStats).exists()).toBe(false)
    expect(wrapper.getComponent(SidePanel).props('appConfig')).toMatchObject({ show_ha_covers: false, show_ha_sensors: false })
    expect(wrapper.findComponent(StatCards).exists()).toBe(true)
    state.value = { ui_config: { settings: { show_daily_stats: true } } }
    await nextTick()
    expect(wrapper.findComponent(DailyStats).exists()).toBe(true)
  })

  it('does not invent an EV card before any configured or observed EV is available', () => {
    const wrapper = render()
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(false)
  })

  it('passes backend SoC unchanged to the main tile and renders only real battery entries', async () => {
    state.value = {
      battery_soc: 73.25, battery_voltage: 51,
      batteries: [{ instance: 0, name: 'SmartShunt', soc: 90 }, { instance: 2, name: 'Virtual battery', soc: 0 }],
    }
    const wrapper = render()
    expect(wrapper.getComponent(StatCards).props('batterySoc')).toBe(73.25)
    expect(wrapper.getComponent(StatCards).text()).toContain('73%')
    const batteryPanel = wrapper.getComponent(BatterySolarPanel)
    expect(batteryPanel.text()).toContain('SmartShunt')
    expect(batteryPanel.text()).toContain('Virtual battery')
    expect(batteryPanel.text()).not.toContain('Bank')
    expect(batteryPanel.props('batteries')).toHaveLength(2)
    state.value = { battery_soc: 0, batteries: [{ instance: 0, name: 'Bank', soc: 0 }] }
    await nextTick()
    expect(wrapper.getComponent(StatCards).text()).toContain('0%')
    expect(batteryPanel.props('batteries')).toHaveLength(1)
    expect(batteryPanel.text()).toContain('Bank')
    state.value = { battery_soc: 60 }
    await nextTick()
    expect(batteryPanel.props('batteries')).toEqual([])
  })

  it('keeps discovered water visible with unknown readings and preserves a measured zero percent', async () => {
    const wrapper = render()
    expect(wrapper.find('[data-testid="water-section"]').exists()).toBe(false)
    state.value = { features: { water: false }, discovered_water_ev: [{ kind: 'tank', instance: 0 }] }
    await nextTick()
    expect(wrapper.get('[data-testid="water-section"]').text()).toContain('—')
    state.value = normalizeTelemetry(JSON.parse('{"water_level":0,"pump_switch":null,"water_valve":null}'))
    await nextTick()
    expect(wrapper.get('[data-testid="water-section"]').text()).toContain('0.0%')
    expect(wrapper.get('[aria-label="Pump manual mode"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Pump manual mode"]').attributes('aria-pressed')).toBeUndefined()
    state.value = {}
    await nextTick()
    expect(wrapper.get('[data-testid="water-section"]').text()).toContain('—')
  })

  it('recognizes native EV clamp names while retaining legacy keyed loads and visibility settings', async () => {
    state.value = { loads: { '81': 1200 }, load_names: { '81': 'EV Charger' }, features: { ev: false } }
    const wrapper = render()
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(true)
    state.value = { loads: { ev_charger: 500 }, features: { ev: false } }
    await nextTick()
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(true)
    state.value = { loads: { '81': Number.NaN }, load_names: { '81': 'EV Charger' }, features: { ev: false } }
    await nextTick()
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(false)
    state.value = { loads: { '81': 1200 }, load_names: { '81': 'EV Charger' }, features: { ev: false },
      ui_config: { settings: { show_ev: false } } }
    await nextTick()
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(false)
  })

  it.each(['mqtt', 'igw'])('uses %s transport and per-target water capabilities without HA or controller dependency', async (source) => {
    state.value = {
      data_source: source, native_connected: true, mqtt_connected: source === 'mqtt',
      gateway_connected: source === 'igw', controller_controls_available: false,
      ha_connected: false, features: { ha: false, water: false }, water_level: 0.5,
      pump_switch: false, water_valve: true, water_pump_mode: 2, pump_mode: 0,
      water_valve_mode: 1, water_controls_available: true,
      water_pump_controls_available: true, water_valve_controls_available: false,
    }
    const wrapper = render()
    expect(wrapper.get('[data-testid="transport-status"]').text()).toBe(source.toUpperCase())
    expect(wrapper.get('[data-testid="water-section"]').text()).toContain('0.5%')
    await wrapper.get('[aria-label="Pump manual mode"]').trigger('click')
    await acceptLatest()
    await wrapper.get('[aria-label="Pump automatic mode"]').trigger('click')
    await wrapper.get('[aria-label="Valve manual mode"]').trigger('click')
    await wrapper.get('[aria-label="Valve automatic mode"]').trigger('click')
    expect(commands.send.mock.calls).toEqual([
      ['water_mode', expect.objectContaining({ which: 'pump', mode: 1, request_id: expect.any(String) })], ['water_mode', expect.objectContaining({ which: 'pump', mode: 0, request_id: expect.any(String) })],
    ])
    expect(wrapper.get('[aria-label="Pump manual mode"]').attributes('aria-pressed')).toBe('false')
    state.value = { ...state.value, native_connected: false }
    await nextTick()
    expect(wrapper.get('[aria-label="Pump manual mode"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Pump automatic mode"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="transport-status"]').attributes('data-connected')).toBe('false')
    await wrapper.get('[aria-label="Pump manual mode"]').trigger('click')
    expect(commands.send).toHaveBeenCalledTimes(2)
  })

  it('keeps IGW header flags and DRY usable while the direct broker is disconnected', async () => {
    state.value = {
      data_source: 'igw', native_connected: true, mqtt_connected: false, gateway_connected: true,
      controller_controls_available: true, booleans: { only_charging: false }, dry_run: false,
      ess_mode: { hub4_mode: 3 },
    }
    const wrapper = render()
    const onlyCharging = wrapper.findAll('button').find(button => button.text() === 'ONLY CHARGING')
    expect(onlyCharging).toBeDefined()
    expect(onlyCharging?.attributes('disabled')).toBeUndefined()
    await onlyCharging?.trigger('click')
    await acceptLatest()
    await wrapper.findAll('button').find(button => button.text() === 'DRY')?.trigger('click')
    expect(commands.send.mock.calls).toEqual([
      ['toggle', expect.objectContaining({ entity: 'only_charging', state: 'on', request_id: expect.any(String) })], ['dry_run', expect.objectContaining({ value: true, request_id: expect.any(String) })],
    ])
    state.value = { ...state.value, ui_config: { settings: { show_header_toggles: false } } }
    await nextTick()
    expect(wrapper.findAll('button').some(button => button.text() === 'ONLY CHARGING')).toBe(false)
  })
})


it('requires fresh local HA capability for Home and rich service commands', async () => {
  state.value = { ha_direct_connected: true, ha_controls_available: true, ha_observed_at: Date.now() / 1000,
    booleans: { home_lamp: false }, ui_config: { home_buttons: [{ id: 'lamp', entity: 'light.configured', label: 'Configured lamp' }] } }
  const wrapper = render()
  const home = () => wrapper.findAll('button').find(button => button.text() === 'Configured lamp')!
  expect(home().attributes('disabled')).toBeUndefined()
  await home().trigger('click')
  expect(commands.send).toHaveBeenCalledWith('toggle', expect.objectContaining({ entity: 'light.configured', request_id: expect.any(String) }))
  expect(home().attributes('disabled')).toBeDefined()
  expect(home().attributes('aria-pressed')).toBe('false')
  await acceptLatest()
  expect(home().attributes('disabled')).toBeUndefined()
  state.value = { ...state.value, ha_observed_at: Date.now() / 1000 - 31 }
  await nextTick()
  expect(home().attributes('disabled')).toBeDefined()
  wrapper.getComponent(SidePanel).vm.$emit('number-set', 'number.configured', 1)
  await nextTick()
  expect(commands.send).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('No change was sent')
})

it('checks override authority at the App boundary independently of DRY and rejects expired status', async () => {
  const request_id = '123e4567-e89b-42d3-a456-426614174000'
  state.value = { native_connected: true, dry_run: true, setpoint_override_controls_available: true,
    setpoint_override_observed_at: Date.now() / 1000,
    setpoint_override: { value: null, last_error: null, request_id: null } }
  const wrapper = render()
  wrapper.getComponent(StatCards).vm.$emit('send', 'set_setpoint_override', { value: -500, request_id })
  expect(commands.send).toHaveBeenCalledWith('set_setpoint_override', { value: -500, request_id })
  state.value = { ...state.value, setpoint_override_observed_at: Date.now() / 1000 - 31 }
  await nextTick()
  wrapper.getComponent(StatCards).vm.$emit('send', 'set_setpoint_override', { value: null, request_id })
  expect(commands.send).toHaveBeenCalledTimes(1)
  expect(useConnection().commandError.value).toMatchObject({ action: 'set_setpoint_override', request_id })
})
