import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { useControllerTariff, type ControllerTariffState } from './useControllerTariff'
import { newDraft, rateGrid, validatePlan } from '../tariffs/model'
import type { EssModeCommandError } from '../essMode'

const NOW = Date.parse('2026-10-06T15:00:00Z')
const REV = 'a'.repeat(64)
const plan = () => validatePlan({ ...newDraft(), timeZone: 'America/Los_Angeles', rates: rateGrid(0.31) })
let scope: EffectScope
function setup(patch: Partial<ControllerTariffState> = {}, readOnly = false) {
  const state = ref<ControllerTariffState>({
    data_source: 'igw', electricity_tariff_observed_at: NOW / 1000,
    electricity_tariff_controls_available: true,
    ui_config: { electricity_tariff: null, electricity_tariff_status: { writable: true, revision: REV, error: null } }, ...patch,
  })
  const connected = ref(true)
  const commandError = ref<EssModeCommandError | null>(null)
  const send = vi.fn<(action: string, payload: Record<string, unknown>) => boolean>(() => true)
  scope = effectScope()
  const api = scope.run(() => useControllerTariff({ state, connected, commandError, send, readOnly }))!
  function ack(value: unknown, extra = {}) {
    const id = (send.mock.calls[0] as unknown as [string, { request_id: string }])[1].request_id
    state.value = { ...state.value, electricity_tariff_observed_at: Date.now() / 1000,
      ui_config: { electricity_tariff: value, electricity_tariff_status: { writable: true, revision: 'b'.repeat(64), request_id: id, error: null, ...extra } } }
  }
  return { ...api, state, connected, commandError, send, ack }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { scope?.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('controller tariff durable acknowledgement', () => {
  it.each([null, plan()])('waits for matching fresh plan acknowledgement including clear', async value => {
    const api = setup()
    const saved = vi.fn()
    const operation = api.save(value, REV).then(saved)
    expect(api.pending.value).toBe(true)
    expect(api.send).toHaveBeenCalledOnce()
    api.ack(value, { request_id: 'old-request' })
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    await expect(api.save(value, REV)).rejects.toThrow('already pending')
    api.ack(value)
    await operation
    expect(saved).toHaveBeenCalledOnce()
    expect(api.pending.value).toBe(false)
    expect(api.send).toHaveBeenCalledOnce()
  })
  it.each([
    { electricity_tariff_controls_available: false },
    { electricity_tariff_observed_at: undefined },
    { electricity_tariff_observed_at: NOW / 1000 - 31 },
    { electricity_tariff_observed_at: NOW / 1000 + 1 },
    { electricity_tariff_observed_at: Infinity },
    { ui_config: { electricity_tariff_status: { writable: false, revision: REV } } },
    { ui_config: { electricity_tariff_status: { writable: true, revision: 'invalid' } } },
  ])('refuses unsupported or stale controller status %j', async patch => {
    const api = setup(patch)
    expect(api.writable.value).toBe(false)
    await expect(api.save(null, REV)).rejects.toThrow('unavailable')
    expect(api.send).not.toHaveBeenCalled()
  })
  it('refuses read-only and disconnected writes', async () => {
    const api = setup({}, true)
    await expect(api.save(null, REV)).rejects.toThrow('unavailable')
    expect(api.send).not.toHaveBeenCalled()
    scope.stop()
    const second = setup()
    second.connected.value = false
    await expect(second.save(null, REV)).rejects.toThrow('unavailable')
    expect(second.send).not.toHaveBeenCalled()
  })
  it('rejects a revision changed while editor was open and invalid plan before sending', async () => {
    const api = setup()
    await expect(api.save(null, 'b'.repeat(64))).rejects.toThrow('changed')
    await expect(api.save({ ...plan(), rates: rateGrid(null) } as never, REV)).rejects.toThrow('Blank cells')
    expect(api.send).not.toHaveBeenCalled()
  })
  it.each(['tariff changed', undefined])('rejects controller error or malformed acknowledgement %j', async error => {
    const api = setup()
    const operation = expect(api.save(null, REV)).rejects.toThrow()
    api.ack(null, { error })
    await operation
    expect(api.send).toHaveBeenCalledOnce()
  })
  it.each([null, { invalid: true }])('rejects an incorrect or malformed readback %j', async readback => {
    const api = setup()
    const operation = expect(api.save(plan(), REV)).rejects.toThrow(/different|invalid/)
    api.ack(readback)
    await operation
  })
  it('surfaces only a correlated server rejection', async () => {
    const api = setup()
    const operation = expect(api.save(null, REV)).rejects.toThrow('Rejected')
    api.commandError.value = { action: 'other', request_id: 'other', error: 'Other' }
    expect(api.pending.value).toBe(true)
    const [, body] = api.send.mock.calls[0] as unknown as [string, { request_id: string }]
    api.commandError.value = { action: 'electricity_tariff', request_id: body.request_id, error: 'Rejected' }
    await operation
  })
  it.each(['disconnect', 'source', 'expiry', 'dispose'])('retires %s without accepting late acknowledgement', async failure => {
    const api = setup()
    const operation = expect(api.save(null, REV)).rejects.toThrow(/unknown|changed/)
    if (failure === 'disconnect') api.connected.value = false
    if (failure === 'source') api.state.value = { ...api.state.value, data_source: 'mqtt' }
    if (failure === 'expiry') api.state.value = { ...api.state.value, electricity_tariff_observed_at: NOW / 1000 - 31 }
    if (failure === 'dispose') scope.stop()
    await operation
    api.connected.value = true
    api.ack(null)
    expect(api.pending.value).toBe(false)
    expect(api.send).toHaveBeenCalledOnce()
  })
  it('times out once and clears timers without retrying', async () => {
    const api = setup()
    const operation = expect(api.save(null, REV)).rejects.toThrow('not confirmed')
    await vi.advanceTimersByTimeAsync(10000)
    await operation
    api.ack(null)
    expect(api.send).toHaveBeenCalledOnce()
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('updates editable state when a status ages without another frame', async () => {
    const api = setup({ electricity_tariff_observed_at: NOW / 1000 - 30 })
    expect(api.writable.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.writable.value).toBe(false)
  })
  it('handles send refusal or exception without retries', async () => {
    const api = setup()
    api.send.mockReturnValue(false)
    await expect(api.save(null, REV)).rejects.toThrow('No change was sent')
    api.send.mockImplementation(() => { throw new Error('transport') })
    await expect(api.save(null, REV)).rejects.toThrow('could not be confirmed')
    expect(api.send).toHaveBeenCalledTimes(2)
  })
  it('uses actual time for a newly observed status after timer throttling', async () => {
    const api = setup()
    vi.setSystemTime(NOW + 40000)
    api.state.value = { ...api.state.value, electricity_tariff_observed_at: (NOW + 40000) / 1000 }
    expect(api.writable.value).toBe(true)
    const operation = api.save(null, REV)
    api.ack(null)
    await operation
  })
  it('rejects a stale click and an expired acknowledgement even if timers were throttled', async () => {
    const api = setup()
    const operation = expect(api.save(null, REV)).rejects.toThrow('not confirmed')
    vi.setSystemTime(NOW + 11000)
    api.ack(null)
    await operation
    vi.setSystemTime(NOW + 42000)
    await expect(api.save(null, 'b'.repeat(64))).rejects.toThrow('unavailable')
    expect(api.send).toHaveBeenCalledOnce()
  })
})
