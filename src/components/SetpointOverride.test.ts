import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SetpointOverride from './SetpointOverride.vue'

const now = Date.parse('2026-10-06T15:00:00Z')
const inactive = { value: null, last_error: null, request_id: null }
const initial = { status: inactive, observedAt: now / 1000, currentSetpoint: -250, connected: true, available: true }
let wrapper: ReturnType<typeof mount<typeof SetpointOverride>>
function button(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === label)!
}
async function open(overrides = {}) {
  wrapper = mount(SetpointOverride, { props: { ...initial, ...overrides }, attachTo: document.body })
  await wrapper.get('[aria-label="Setpoint override"]').trigger('click')
  await flushPromises()
}
async function submit(value = '-500') {
  const input = document.querySelector<HTMLInputElement>('input')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
}
function sent() {
  const [action, payload] = wrapper.emitted('send')![0] as [string, { value: number | null; request_id: string }]
  expect(action).toBe('set_setpoint_override')
  return payload
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('persistent setpoint override', () => {
  it('opens without a command and explains persistence after the browser closes', async () => {
    await open()
    expect(document.querySelector('input')?.value).toBe('-250')
    expect(document.body.textContent).toContain('every 2 seconds until stopped')
    expect(document.body.textContent).toContain('even after this page closes')
    expect(wrapper.emitted('send')).toBeUndefined()
    button('Cancel').click()
    await nextTick()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it.each([-2147483648, -500, 0, 2147483647])('sends %s once and requires an exact fresh acknowledgement', async (value) => {
    await open()
    await submit(String(value))
    const payload = sent()
    expect(payload.value).toBe(value)
    expect(payload.request_id).toMatch(/^[0-9a-f-]{36}$/)
    await submit('123')
    expect(wrapper.emitted('send')).toHaveLength(1)
    await wrapper.setProps({ status: { value, last_error: null, request_id: 'old-request' } })
    expect(document.body.textContent).toContain('Waiting for the controller')
    await wrapper.setProps({ status: { value, last_error: null, request_id: payload.request_id } })
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.text()).toContain(`${value} W · 2s`)
  })

  it('stops with explicit null and waits for matching confirmation', async () => {
    await open({ status: { value: -1000, last_error: null, request_id: 'previous' } })
    button('Stop override').click()
    await nextTick()
    const payload = sent()
    expect(payload.value).toBeNull()
    expect(wrapper.text()).toContain('-1000 W')
    await wrapper.setProps({ status: { value: null, last_error: null, request_id: payload.request_id } })
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.text()).not.toContain('-1000 W')
  })

  it.each(['', '1.5', '1e3', '0x10', 'NaN', 'Infinity', '-2147483649', '2147483648'])('rejects invalid input %j without sending', async (value) => {
    await open()
    await submit(value)
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(document.body.textContent).toContain('Enter a whole number')
  })

  it.each([
    { connected: false }, { available: false }, { observedAt: null },
    { observedAt: now / 1000 - 31 }, { observedAt: now / 1000 + 1 },
    { status: null }, { status: { value: null } },
  ])('does not send without live support: %j', async (unavailable) => {
    await open(unavailable)
    await submit()
    expect(button('OK').disabled).toBe(true)
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('blocks a read-only browser even with fresh capability data', async () => {
    await open({ readOnly: true })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it.each([
    { last_error: 'Controller rejected override', value: -500 },
    { last_error: null, value: -499 },
  ])('shows a rejected or mismatched result without optimistic success: %j', async (status) => {
    await open()
    await submit()
    await wrapper.setProps({ status: { ...status, request_id: sent().request_id } })
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/rejected|different/)
    expect(document.body.textContent).not.toContain('Waiting for the controller')
  })

  it('ignores unrelated server errors and shows the error for this request', async () => {
    await open()
    await submit()
    const payload = sent()
    await wrapper.setProps({ commandError: { action: 'set_setpoint_override', request_id: 'old', error: 'Unrelated' } })
    expect(document.body.textContent).not.toContain('Unrelated')
    await wrapper.setProps({ commandError: { action: 'set_setpoint_override', request_id: payload.request_id, error: 'Controller unavailable' } })
    expect(document.body.textContent).toContain('Controller unavailable')
    expect(document.body.textContent).not.toContain('Waiting for the controller')
  })

  it('retires a pending request on disconnect so its delayed response cannot close the dialog', async () => {
    await open()
    await submit()
    const payload = sent()
    await wrapper.setProps({ connected: false })
    expect(document.body.textContent).toContain('result is unknown')
    await wrapper.setProps({ connected: true, status: { value: -500, last_error: null, request_id: payload.request_id } })
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('result is unknown')
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('retires an old source request even when the replacement transport remains connected', async () => {
    await open({ source: 'mqtt' })
    await submit()
    const payload = sent()
    await wrapper.setProps({ source: 'igw', connected: true, status: { value: -500, last_error: null, request_id: payload.request_id } })
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('result is unknown')
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('does not resend or confirm after a timeout and releases its timers', async () => {
    await open()
    await submit()
    const payload = sent()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(document.body.textContent).toContain('Change unconfirmed')
    await wrapper.setProps({ status: { value: -500, last_error: null, request_id: payload.request_id } })
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(wrapper.emitted('send')).toHaveLength(1)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ages support without another server message', async () => {
    await open()
    await vi.advanceTimersByTimeAsync(31_000)
    await submit()
    expect(button('OK').disabled).toBe(true)
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('uses actual time after timer throttling and applies a fresh acknowledgement frame atomically', async () => {
    await open()
    vi.setSystemTime(now + 40000)
    await wrapper.setProps({ observedAt: (now + 40000) / 1000 })
    expect(button('OK').disabled).toBe(false)
    await submit()
    const payload = sent()
    vi.setSystemTime(now + 40500)
    await wrapper.setProps({ status: { value: -500, last_error: null, request_id: payload.request_id }, observedAt: (now + 40500) / 1000 })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('refuses a stale click even when the freshness timer has not run', async () => {
    await open()
    vi.setSystemTime(now + 31000)
    await submit()
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('does not accept a delayed acknowledgement when the deadline timer was throttled', async () => {
    await open()
    await submit()
    const payload = sent()
    vi.setSystemTime(now + 11000)
    await wrapper.setProps({ status: { value: -500, last_error: null, request_id: payload.request_id }, observedAt: (now + 11000) / 1000 })
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('Change unconfirmed')
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('does not send when a secure correlation ID cannot be created', async () => {
    vi.stubGlobal('crypto', {})
    await open()
    await submit()
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(document.body.textContent).toContain('No change was sent')
  })
})
