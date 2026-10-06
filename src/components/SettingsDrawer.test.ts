import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { state } from '../composables/useInverterState'
import { i18n } from '../i18n'
import TariffConfiguration from '../tariffs/TariffConfiguration.vue'
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
    expect(boxes).toHaveLength(16)
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
    expect(saveEv.mqtt_host).toBeUndefined() // unchanged connection values are not rewritten
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

it('forwards controller tariff authority and the asynchronous save contract only through Settings', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const wrapper = mount(SettingsDrawer, { props: { open: true, tariffWritable: true,
    tariffRevision: 'a'.repeat(64), saveControllerTariff: save }, global: { plugins: [i18n] } })
  const tariff = wrapper.getComponent(TariffConfiguration)
  expect(tariff.props('controllerWritable')).toBe(true)
  expect(tariff.props('controllerRevision')).toBe('a'.repeat(64))
  await tariff.props('savePlan')!(null, 'a'.repeat(64))
  expect(save).toHaveBeenCalledWith(null, 'a'.repeat(64))
  await wrapper.setProps({ tariffWritable: false })
  expect(tariff.props('controllerWritable')).toBe(false)
  wrapper.unmount()
})

function settingsWrapper(settings: Record<string, unknown>) {
  state.value = { ...state.value, ui_config: { settings } }
  return mount(SettingsDrawer, { props: { open: true }, global: { plugins: [i18n],
    stubs: { SystemNotificationSettings: true, TariffConfiguration: true } } })
}

function connectionInput(wrapper: ReturnType<typeof settingsWrapper>, label: string) {
  return wrapper.findAll('label').find((node) => node.text() === label)!.get('input')
}

it('saves camera-only edits with IGW empty MQTT host and zero port without resending defaults or masked secrets', async () => {
  const wrapper = settingsWrapper({ mqtt_host: '', mqtt_port: 0, ha_url: 'https://ha.example',
    mqtt_password: '***', ha_token: '***', camera_topic: 'old/camera' })
  await wrapper.find('input').setValue('new/camera')
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')).toEqual([[{ camera_topic: 'new/camera' }]])
  wrapper.unmount()
})

it('permits intentional empty connection strings while leaving untouched masked secrets out', async () => {
  const wrapper = settingsWrapper({ mqtt_host: 'cerbo', mqtt_port: 1883, ha_url: 'https://ha.example',
    mqtt_password: '***', ha_token: '***' })
  await connectionInput(wrapper, 'MQTT host').setValue('')
  await connectionInput(wrapper, 'HA URL').setValue('')
  await connectionInput(wrapper, 'HA token').setValue('')
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')).toEqual([[{ camera_topic: '', mqtt_host: '', ha_url: '', ha_token: '' }]])
  wrapper.unmount()
})

it.each(['', '0', '65536', '1883.5', 'not-a-port'])('refuses changed invalid MQTT port %j without emitting a partial settings patch', async (port) => {
  const wrapper = settingsWrapper({ mqtt_port: 1883 })
  await connectionInput(wrapper, 'MQTT port').setValue(port)
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('1 to 65535')
  wrapper.unmount()
})

it('compares edits against the captured opening baseline and reseeds after reopening', async () => {
  const wrapper = settingsWrapper({ mqtt_host: 'original', mqtt_port: 0, ha_token: '***' })
  state.value = { ...state.value, ui_config: { settings: { mqtt_host: 'changed-remotely', mqtt_port: 1883, ha_token: '***' } } }
  await flushPromises()
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')).toEqual([[{ camera_topic: '' }]])
  await wrapper.setProps({ open: false })
  await wrapper.setProps({ open: true })
  expect((connectionInput(wrapper, 'MQTT host').element as HTMLInputElement).value).toBe('changed-remotely')
  await connectionInput(wrapper, 'MQTT port').setValue('8883')
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')?.[1]).toEqual([{ camera_topic: '', mqtt_port: 8883 }])
  wrapper.unmount()
})

it('omits unsupported MQTT credentials for Go settings while preserving its supplied connection fields', async () => {
  const wrapper = settingsWrapper({ mqtt_host: '', mqtt_port: 0, ha_url: '', ha_token: '***' })
  const labels = wrapper.findAll('label').map((label) => label.text())
  expect(labels).not.toContain('MQTT user')
  expect(labels).not.toContain('MQTT pass')
  expect(labels).toContain('MQTT host')
  expect(labels).toContain('HA token')
  await wrapper.find('button.bg-blue-600').trigger('click')
  expect(wrapper.emitted('save')).toEqual([[{ camera_topic: '' }]])
  wrapper.unmount()
})
