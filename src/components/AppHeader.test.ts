import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { useHA } from '../composables/useHA'
import { state } from '../composables/useInverterState'
import { DEFAULT_INVERTER_CONTROLS } from '../utils'
import AppHeader from './AppHeader.vue'

const props = {
  dryRun: false, essClass: 'on', essText: 'External', isDark: false,
  controlsAvailable: true, headerToggles: DEFAULT_INVERTER_CONTROLS,
  toggleStates: { only_charging: 'on', no_feed: 'off' },
}
const global = { stubs: { NotificationHistory: true } }
afterEach(() => { state.value = {} })

describe('controller header without Home Assistant', () => {
  it('shows all seven controls with HA absent and disables unknown flags', () => {
    state.value = { ha_connected: false, features: { ha: false }, booleans: { only_charging: false } }
    const ha = useHA()
    const wrapper = mount(AppHeader, {
      props: { ...props, headerToggles: ha.headerToggles.value, toggleStates: ha.headerToggleStates.value }, global,
    })
    const controls = wrapper.findAll('button').filter((button) => DEFAULT_INVERTER_CONTROLS.some((item) => item.label === button.text()))
    expect(controls).toHaveLength(7)
    expect(controls[0].attributes('disabled')).toBeUndefined()
    expect(controls[0].attributes('aria-pressed')).toBe('false')
    expect(controls[1].attributes('disabled')).toBeDefined()
    expect(controls[1].attributes('aria-pressed')).toBeUndefined()
    wrapper.unmount()
    ha.cleanupHa()
  })

  it('emits deterministic MQTT commands and explicit DRY values', async () => {
    const wrapper = mount(AppHeader, { props, global })
    await wrapper.findAll('button').find((button) => button.text() === 'ONLY CHARGING')?.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'NO FEED')?.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'DRY')?.trigger('click')
    expect(wrapper.emitted('send')).toEqual([
      ['toggle', { entity: 'only_charging', state: 'off' }],
      ['toggle', { entity: 'no_feed', state: 'on' }],
      ['dry_run', { value: true }],
    ])
    wrapper.unmount()
  })

  it('disables writes after controller/transport loss without hiding controls', async () => {
    const wrapper = mount(AppHeader, { props: { ...props, controlsAvailable: false }, global })
    for (const text of ['DRY', 'ONLY CHARGING', 'NO FEED']) {
      const button = wrapper.findAll('button').find((item) => item.text() === text)
      expect(button?.attributes('disabled')).toBeDefined()
      await button?.trigger('click')
    }
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.get('[aria-haspopup="menu"]').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('keeps unknown ESS and DRY distinct from off', () => {
    const wrapper = mount(AppHeader, { props: { ...props, dryRun: undefined, essClass: 'unavailable', essText: 'ESS —' }, global })
    for (const text of ['DRY']) {
      const button = wrapper.findAll('button').find((item) => item.text() === text)
      expect(button?.attributes('disabled')).toBeDefined()
      expect(button?.attributes('aria-pressed')).toBeUndefined()
    }
    wrapper.unmount()
  })

  it('respects explicit empty advertised controls', () => {
    state.value = { ui_config: { header_toggles: [] } }
    const ha = useHA()
    expect(ha.headerToggles.value).toEqual([])
    ha.cleanupHa()
  })
})
