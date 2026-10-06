import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
const methods = vi.hoisted(() => ({ enable: vi.fn(), disable: vi.fn(), test: vi.fn(), savePreferences: vi.fn(), refresh: vi.fn() }))
vi.mock('../composables/useSystemNotifications', () => ({ useSystemNotifications: () => ({
  ...methods, status: ref('Off'), permission: ref('default'), supported: ref(true), busy: ref(false), ready: ref(false), server: ref({ available: true }),
  preferences: ref({ native: true, ev: true, water: true, lowBattery: true }), error: ref(''), notice: ref(''),
}) }))
import SystemNotificationSettings from './SystemNotificationSettings.vue'
describe('system notification settings', () => {
  it('exposes opt-in categories and no automatic permission or test action', async () => {
    const view = mount(SystemNotificationSettings)
    await flushPromises()
    expect(view.text()).toContain('Browser permission: default')
    expect(view.text()).toContain('original occurrence time')
    expect(view.findAll('input[type="checkbox"]')).toHaveLength(4)
    expect(methods.enable).not.toHaveBeenCalled()
    expect(methods.test).not.toHaveBeenCalled()
    const buttons = view.findAll('button')
    expect(buttons.find((button) => button.text() === 'Send test')?.attributes('disabled')).toBeDefined()
    await buttons.find((button) => button.text() === 'Enable')?.trigger('click')
    expect(methods.enable).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
