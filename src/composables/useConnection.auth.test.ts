import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/publicMode', () => ({
  apiUrl: (path: string) => path,
  gatewaySnapshotUrl: () => '/snapshot',
  isPublicMode: () => false,
}))
vi.mock('./useChart', () => ({ addHistoryPoint: vi.fn() }))

import { useConnection } from './useConnection'
import { mqttConnected } from './useInverterState'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  url: string
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
  }
  send() {}
}

describe('private mode forwards page token', () => {
  let connection: ReturnType<typeof useConnection>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.stubGlobal('location', {
      protocol: 'https:',
      host: 'dash.example',
      search: '?token=a%26b%2Bc',
    })
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mqtt_connected: true, gt: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    mqttConnected.value = false
    connection = useConnection()
  })

  afterEach(() => {
    connection.cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens WebSocket with token query', () => {
    connection.connectMqtt()
    expect(FakeWebSocket.instances[0]?.url).toBe('wss://dash.example/ws?token=a%26b%2Bc')
  })

  it('polls /api/state with token query', async () => {
    connection.connectMqtt()
    // force poll path: no recent WS message by leaving lastMessageTime old via timer
    await vi.advanceTimersByTimeAsync(0)
    // first poll happens in startHttpPoll; WS is OPEN so pollHttpState may skip if lastMessageTime fresh
    // advance past 8000ms silence window without messages
    await vi.advanceTimersByTimeAsync(9000)
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls.some((u) => String(u).includes('/api/state?token=a%26b%2Bc'))).toBe(true)
  })
})
