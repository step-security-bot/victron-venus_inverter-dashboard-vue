import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { ESS_MODES } from '../essMode'
import EssModeMenu from './EssModeMenu.vue'

const props = {
  mode: { selected: 'external_control' as const, selection_supported: true },
  label: 'External', active: true, connected: true, fresh: true, dryRun: false,
  controlsAvailable: true,
}
let wrapper: ReturnType<typeof mount<typeof EssModeMenu>>
const choices = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const choose = async (label: string) => {
  choices().find((button) => button.textContent?.includes(label))!.click()
  await nextTick()
}
async function open(overrides = {}) {
  wrapper = mount(EssModeMenu, { props: { ...props, ...overrides }, attachTo: document.body })
  await wrapper.get('[aria-haspopup="menu"]').trigger('click')
  await flushPromises()
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.useRealTimers() })

describe('explicit ESS mode menu', () => {
  it('opens without a command and highlights the actual controller selection', async () => {
    await open()
    expect(choices().map((button) => button.textContent?.trim())).toEqual(ESS_MODES.map((m) => m.label))
    expect(choices().filter((button) => button.getAttribute('aria-checked') === 'true').map((button) => button.textContent?.trim())).toEqual(['External control'])
    expect(document.activeElement).toBe(choices()[5])
    expect(wrapper.emitted('send')).toBeUndefined()
    await choose('External control')
    expect(choices()).toHaveLength(0)
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it.each(ESS_MODES.slice(0, -1))('sends explicit $id and waits for a matching controller acknowledgement', async (option) => {
    await open()
    await choose(option.label)
    const [action, payload] = wrapper.emitted('send')![0] as [string, { mode: string; request_id: string }]
    expect(action).toBe('set_ess_mode')
    expect(payload.mode).toBe(option.id)
    expect(payload.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(document.body.textContent).toContain('Waiting for the controller')
    expect(choices()[5].getAttribute('aria-checked')).toBe('true')
    await choose('Off')
    expect(wrapper.emitted('send')).toHaveLength(1)
    await wrapper.setProps({ mode: { ...props.mode, request_id: 'other', selected: option.id } })
    expect(document.body.textContent).toContain('Waiting for the controller')
    await wrapper.setProps({ mode: { ...props.mode, request_id: payload.request_id, selected: option.id } })
    expect(document.body.textContent).not.toContain('Waiting for the controller')
    expect(choices().find((button) => button.getAttribute('aria-checked') === 'true')?.textContent?.trim()).toBe(option.label)
  })

  it.each([
    { connected: false }, { fresh: false }, { dryRun: true }, { dryRun: undefined },
    { controlsAvailable: false }, { mode: { selection_supported: false } },
  ])('keeps options inspectable but blocks an unsafe command: %j', async (overrides) => {
    await open(overrides)
    expect(choices()).toHaveLength(6)
    expect(choices().every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(true)
    await choose('Off')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it.each([{ connected: false }, { fresh: false }])('does not confirm a matching retained/stale response: %j', async (unavailable) => {
    await open()
    await choose('Off')
    const [, payload] = wrapper.emitted('send')![0] as [string, { request_id: string }]
    await wrapper.setProps({ ...unavailable, mode: { ...props.mode, selected: 'off', request_id: payload.request_id } })
    expect(document.body.textContent).toContain('Waiting for the controller')
    await wrapper.setProps({ connected: true, fresh: true })
    expect(document.body.textContent).not.toContain('Waiting for the controller')
  })

  it('handles only matching server errors without fabricating selected telemetry', async () => {
    await open()
    await choose('Off')
    const [, payload] = wrapper.emitted('send')![0] as [string, { request_id: string }]
    await wrapper.setProps({ commandError: { action: 'set_ess_mode', request_id: 'old', error: 'Old failure' } })
    expect(document.body.textContent).not.toContain('Old failure')
    await wrapper.setProps({ commandError: { action: 'set_ess_mode', request_id: payload.request_id, error: 'Controller status expired' } })
    expect(document.body.textContent).toContain('Controller status expired')
    expect(choices()[5].getAttribute('aria-checked')).toBe('true')
  })

  it('reports an unconfirmed timeout and supports keyboard and outside dismissal', async () => {
    await open()
    choices()[5].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(choices()[0])
    await choose('Off')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(document.body.textContent).toContain('Change unconfirmed')
    choices()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(choices()).toHaveLength(0)
    expect(document.activeElement).toBe(wrapper.get('[aria-haspopup="menu"]').element)
    await wrapper.get('[aria-haspopup="menu"]').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(choices()).toHaveLength(0)
  })
})
