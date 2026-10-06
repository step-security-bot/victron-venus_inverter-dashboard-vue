import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import SidePanel from './SidePanel.vue'

const props = {
  evCharging: '', evPower: '', evPowerWatts: 0, evChargingKw: 0, evLoadPower: 0,
  pumpSwitchEntity: '', waterValveEntity: '', homeButtons: [], buttonStates: {},
  haSensors: [{ entity_id: 'sensor.test', name: 'Sensor', state: '1', unit: 'W' }],
  haNumbers: [{ entity_id: 'number.test', name: 'Number', value: 1, min: 0, max: 10, step: 1, unit: '' }],
  haCovers: [{ entity_id: 'cover.test', name: 'Cover', position: 50 }],
  haMediaPlayers: [{ entity_id: 'media_player.test', name: 'Player', state: 'paused' }],
  haScenes: [{ entity_id: 'scene.test', name: 'Scene' }],
  haWeather: null,
}

describe('SidePanel disclosures', () => {
  it('renders discovered idle EV values even when the legacy feature flag is off', () => {
    const wrapper = mount(SidePanel, {
      props: { ...props, features: { ev: false }, evPresent: true, carSoc: 0, evPower: '0W' },
      global: { plugins: [i18n] },
    })
    const ev = wrapper.get('[data-testid="ev-section"]')
    expect(ev.text()).toContain('0.0kW')
    expect(ev.text()).toContain('0W')
    expect(ev.text()).toContain('0%')
    expect(ev.text()).toContain('Charger')
    wrapper.unmount()
  })

  it('shows missing EV readings as unknown and respects the explicit visibility setting', async () => {
    const wrapper = mount(SidePanel, {
      props: { ...props, features: { ev: false }, evPresent: true, evPowerWatts: undefined, evChargingKw: undefined, evPower: '—' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.get('[data-testid="ev-section"]').text()).not.toContain('0.0kW')
    expect(wrapper.get('[data-testid="ev-section"]').text()).not.toContain('0%')
    await wrapper.setProps({ showEv: false })
    expect(wrapper.find('[data-testid="ev-section"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses native buttons and exposes the expanded state for all five sections', async () => {
    const wrapper = mount(SidePanel, { props, global: { plugins: [i18n] } })
    const controls = wrapper.findAll('button[aria-expanded]')
    expect(controls).toHaveLength(5)
    for (const control of controls) {
      expect(control.element).toBeInstanceOf(HTMLButtonElement)
      expect(control.attributes('type')).toBe('button')
      expect(control.attributes('aria-expanded')).toBe('false')
      await control.trigger('click')
      expect(control.attributes('aria-expanded')).toBe('true')
      await control.trigger('click')
      expect(control.attributes('aria-expanded')).toBe('false')
    }
    wrapper.unmount()
  })

  it('keeps command controls hidden in public read-only mode', () => {
    const wrapper = mount(SidePanel, {
      props: { ...props, readOnly: true }, global: { plugins: [i18n] },
    })
    expect(wrapper.findAll('button[aria-expanded]')).toHaveLength(1)
    expect(wrapper.emitted()).toEqual({})
    wrapper.unmount()
  })
})


describe('desktop appliance and configured Home parity', () => {
  it('hides absent and idle appliances and shows only active enabled sections', async () => {
    const wrapper = mount(SidePanel, { props, global: { plugins: [i18n] } })
    expect(wrapper.find('[data-testid="appliances"]').exists()).toBe(false)
    await wrapper.setProps({ dishwasherRunning: false, washerRunning: false, dryerRunning: false })
    expect(wrapper.find('[data-testid="appliances"]').exists()).toBe(false)
    await wrapper.setProps({ dishwasherRunning: true, washerRunning: true, dryerRunning: true })
    for (const name of ['dishwasher', 'washer', 'dryer']) expect(wrapper.get(`[data-testid="${name}"]`).text()).toContain('Running')
    await wrapper.setProps({ showDishwasher: false, showWasher: false, showDryer: false })
    expect(wrapper.find('[data-testid="appliances"]').exists()).toBe(false)
    await wrapper.setProps({ showWasher: true })
    expect(wrapper.find('[data-testid="dishwasher"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="dryer"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="washer"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders only configured Home entities in order with full labels and blocks unknown states', async () => {
    const homeButtons = [
      { id: 'laundry', label: 'Laundry', entity: 'switch.configured_laundry' },
      { id: 'guard', label: 'Bedroom guard 3', entity: 'switch.custom_guard' },
      { id: 'lamp', label: 'My lamp', entity: 'light.custom_lamp' },
    ]
    const wrapper = mount(SidePanel, { props: { ...props, homeButtons, haControlsAvailable: true, buttonStates: { laundry: 'on', guard: 'off', lamp: 'unavailable' } }, global: { plugins: [i18n] } })
    const buttons = wrapper.findAll('button').filter((b) => homeButtons.some((item) => item.label === b.text()))
    expect(buttons.map((button) => button.text())).toEqual(homeButtons.map((button) => button.label))
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    expect(buttons[1].attributes('aria-pressed')).toBe('false')
    expect(buttons[2].attributes('disabled')).toBeDefined()
    await buttons[1].trigger('click')
    await buttons[2].trigger('click')
    expect(wrapper.emitted('send')).toEqual([['toggle', { entity: 'switch.custom_guard' }]])
    await wrapper.setProps({ haControlsAvailable: false })
    expect(buttons[0].attributes('disabled')).toBeDefined()
    await buttons[0].trigger('click')
    expect(wrapper.emitted('send')).toHaveLength(1)
    await wrapper.setProps({ homeButtons: [] })
    expect(wrapper.text()).not.toContain('Bedroom guard 3')
    expect(wrapper.text()).not.toContain('Laundry')
    wrapper.unmount()
  })
})
