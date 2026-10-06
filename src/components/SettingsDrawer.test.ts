import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { state } from '../composables/useInverterState'
import { i18n } from '../i18n'
import SettingsDrawer from './SettingsDrawer.vue'

describe('SettingsDrawer', () => {
  it('renders visibility toggles from ui_config.settings and emits patches', async () => {
    state.value = {
      ...state.value,
      ui_config: {
        ...state.value.ui_config,
        settings: {
          show_ev: false,
          camera_topic: 'frigate/+/events',
          mqtt_host: 'Cerbo',
          ha_token: '***',
        },
      },
    }
    const w = mount(SettingsDrawer, { props: { open: true }, global: { plugins: [i18n] } })
    const boxes = w.findAll('[aria-label="Dashboard sections"] input[type="checkbox"]')
    expect(boxes).toHaveLength(9)
    expect(w.get('[aria-label="Electricity tariff"]').text()).toContain('Use a local tariff on this device')
    // show_ev false → first toggle unchecked
    expect((boxes[0].element as HTMLInputElement).checked).toBe(false)
    expect((w.find('input:not([type="checkbox"])').element as HTMLInputElement).value).toBe(
      'frigate/+/events'
    )

    await boxes[1].setValue(false) // show_washer off
    const ev = w.emitted('save')
    expect(ev?.[0]?.[0]).toEqual({ show_washer: false })

    await w.find('button.bg-blue-600').trigger('click')
    const saveEv = w.emitted('save')?.[1]?.[0] as Record<string, unknown>
    expect(saveEv.camera_topic).toBe('frigate/+/events')
    expect(saveEv.mqtt_host).toBe('Cerbo') // seeded from server state
    expect(saveEv.ha_token).toBeUndefined() // masked '***' never sent back
    await w.get('input').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('close')).toHaveLength(1)
    w.unmount()
  })
})

it('keeps tariff settings and nested editor Escape separate from closing the drawer', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  const w = mount(SettingsDrawer, {
    props: { open: true },
    global: { plugins: [i18n], stubs: { TariffEditor: { template: '<div data-testid="tariff-editor"><button>Editor action</button></div>' } } },
  })
  await w.findAll('button').find((b) => b.text().includes('Use a local tariff'))!.trigger('click')
  await w.findAll('button').find((b) => b.text() === 'Set tariff')!.trigger('click')
  await flushPromises()
  await w.get('[data-testid="tariff-editor"] button').trigger('keydown', { key: 'Escape' })
  expect(w.emitted('close')).toBeUndefined()
  await w.get('input').trigger('keydown', { key: 'Escape' })
  expect(w.emitted('close')).toHaveLength(1)
  w.unmount()
  vi.unstubAllGlobals()
})
