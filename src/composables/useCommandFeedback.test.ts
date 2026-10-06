import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useCommandFeedback, type CommandResult } from './useCommandFeedback'
import type { EssModeCommandError } from '../essMode'

afterEach(() => vi.useRealTimers())
function setup(send = vi.fn().mockReturnValue(true)) {
  const connected = ref(true)
  const error = ref<EssModeCommandError | null>(null)
  const result = ref<CommandResult | null>(null)
  const scope = effectScope()
  const feedback = scope.run(() => useCommandFeedback(connected, error, result, send))!
  return { connected, error, result, scope, feedback, send }
}
describe('command transport feedback', () => {
  it('correlates acceptance without claiming physical acknowledgement or accepting unrelated errors', async () => {
    const t = setup()
    t.feedback.submit('toggle', { entity: 'light.configured' })
    const id = t.send.mock.calls[0][1].request_id
    expect(t.feedback.busy.value).toBe(true)
    t.feedback.submit('toggle', { entity: 'light.other' })
    expect(t.send).toHaveBeenCalledTimes(1)
    t.error.value = { action: 'toggle', request_id: 'old', error: 'Unrelated' }
    await nextTick()
    expect(t.feedback.busy.value).toBe(true)
    t.result.value = { action: 'toggle', request_id: id, status: 'accepted' }
    await nextTick()
    expect(t.feedback.busy.value).toBe(false)
    expect(t.feedback.message.value).toContain('accepted by server')
    expect(t.feedback.message.value).toContain('live telemetry')
    t.scope.stop()
  })
  it('retires pending on connection loss so a late accepted response cannot hide uncertainty', async () => {
    const t = setup()
    t.feedback.submit('water_mode', { which: 'pump', mode: 1 })
    const id = t.send.mock.calls[0][1].request_id
    t.connected.value = false
    await nextTick()
    t.connected.value = true
    t.result.value = { action: 'water_mode', request_id: id, status: 'accepted' }
    await nextTick()
    expect(t.feedback.message.value).toContain('outcome is unknown')
    expect(t.feedback.failed.value).toBe(true)
    t.scope.stop()
  })
  it.each(['false', 'throw'])('reports local send %s without leaking transport errors', kind => {
    const t = setup(vi.fn().mockImplementation(() => { if (kind === 'throw') throw new Error('secret'); return false }))
    t.feedback.submit('toggle', {})
    expect(t.feedback.busy.value).toBe(false)
    expect(t.feedback.message.value).toContain('No change was sent')
    expect(t.feedback.message.value).not.toContain('secret')
    t.scope.stop()
  })
  it('does not turn a late accepted response into success when a background timer was throttled', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.feedback.submit('toggle', {})
    const id = t.send.mock.calls[0][1].request_id
    vi.setSystemTime(Date.now() + 11000)
    t.result.value = { action: 'toggle', request_id: id, status: 'accepted' }
    await nextTick()
    expect(t.feedback.message.value).toContain('No timely server confirmation')
    expect(t.feedback.failed.value).toBe(true)
    t.scope.stop()
  })

  it('bounds pending time and clears its timer on unmount without retrying', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.feedback.submit('dry_run', { value: true })
    await vi.advanceTimersByTimeAsync(10000)
    expect(t.feedback.message.value).toContain('No server confirmation')
    expect(t.send).toHaveBeenCalledTimes(1)
    t.feedback.submit('dry_run', { value: true })
    t.scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
