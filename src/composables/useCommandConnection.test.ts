import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConnection } from './useConnection'
import { mqttConnected, state } from './useInverterState'

vi.mock('../config/publicMode', () => ({
  apiUrl: (path: string) => path,
  gatewaySnapshotUrl: () => '/snapshot',
  isPublicMode: () => false,
}))
vi.mock('./useChart', () => ({ addHistoryPoint: vi.fn() }))

class FakeSocket {
  static OPEN = 1
  static latest: FakeSocket
  readyState = 0
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  onmessage?: (event: { data: string }) => void
  send = vi.fn()
  constructor() { FakeSocket.latest = this }
  close() { this.readyState = 3 }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('command channel availability', () => {
  it('keeps writes unavailable while HTTP telemetry is live but WebSocket is down', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data_source: 'igw', gateway_connected: true }),
    }))
    const connection = useConnection()
    connection.connectMqtt()
    await vi.advanceTimersByTimeAsync(0)
    expect(mqttConnected.value).toBe(true)
    expect(connection.commandConnected.value).toBe(false)
    FakeSocket.latest.readyState = FakeSocket.OPEN
    FakeSocket.latest.onopen?.()
    expect(connection.commandConnected.value).toBe(true)
    FakeSocket.latest.onerror?.()
    await vi.advanceTimersByTimeAsync(3000)
    expect(mqttConnected.value).toBe(true)
    expect(connection.commandConnected.value).toBe(false)
    connection.cleanup()
  })
})


it('routes correlated command errors without replacing telemetry or connection state', () => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
  const connection = useConnection()
  connection.connectMqtt()
  FakeSocket.latest.readyState = FakeSocket.OPEN
  FakeSocket.latest.onopen?.()
  state.value = { gt: 42, ess_mode: { selected: 'external_control', selection_supported: true } }
  mqttConnected.value = false
  const error = { type: 'command_error', action: 'set_ess_mode', request_id: 'request-123', error: 'Stale controller status' }
  FakeSocket.latest.onmessage?.({ data: JSON.stringify(error) })
  expect(connection.commandError.value).toEqual({ action: error.action, request_id: error.request_id, error: error.error })
  expect(state.value.gt).toBe(42)
  expect(state.value.ess_mode?.selected).toBe('external_control')
  expect(mqttConnected.value).toBe(false)
  expect(connection.commandConnected.value).toBe(true)
  FakeSocket.latest.onmessage?.({ data: JSON.stringify({ type: 'command_error', error: null }) })
  expect(connection.commandError.value?.request_id).toBe('request-123')
  connection.cleanup()
})
