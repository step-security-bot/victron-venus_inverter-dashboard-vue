import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/publicMode', () => ({
  apiUrl: (path: string) => path,
  gatewaySnapshotUrl: () => '/snapshot',
  isPublicMode: () => false,
}))
vi.mock('./useChart', () => ({ addHistoryPoint: vi.fn() }))

import { addHistoryPoint } from './useChart'
import { useConnection } from './useConnection'
import { mqttConnected, state } from './useInverterState'

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  closeCalls = 0
  sent: string[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  close() {
    this.closeCalls++
    this.readyState = 2
    setTimeout(() => {
      this.readyState = 3
      this.onclose?.()
    }, 0)
  }

  send(message: string) {
    this.sent.push(message)
  }
}

describe('private connection lifetime', () => {
  let connection: ReturnType<typeof useConnection>
  let fetchMock: ReturnType<typeof vi.fn>
  let documentListeners: ReturnType<typeof vi.spyOn>
  let windowListeners: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { protocol: 'https:', host: 'dash.example', search: '?token=secret' })
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gt: 1, mqtt_connected: true }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    documentListeners = vi.spyOn(document, 'addEventListener')
    windowListeners = vi.spyOn(window, 'addEventListener')
    mqttConnected.value = false
    connection = useConnection()
  })

  afterEach(() => {
    connection.cleanup()
    // Isolate the baseline failures too: its production cleanup leaks listeners.
    for (const [name, listener] of documentListeners.mock.calls) {
      document.removeEventListener(name, listener)
    }
    for (const [name, listener] of windowListeners.mock.calls) {
      window.removeEventListener(name, listener)
    }
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not reconnect when close arrives after cleanup', async () => {
    connection.connectMqtt()
    FakeWebSocket.instances[0].open()
    connection.cleanup()
    await vi.advanceTimersByTimeAsync(15000)
    expect(vi.getTimerCount()).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(connection.commandConnected.value).toBe(false)
    expect(mqttConnected.value).toBe(false)
  })

  it('does not create a second socket while the first is connecting', () => {
    connection.connectMqtt()
    connection.connectMqtt()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('removes global listeners and never resumes a disposed connection', async () => {
    const documentRemove = vi.spyOn(document, 'removeEventListener')
    const windowRemove = vi.spyOn(window, 'removeEventListener')
    connection.connectMqtt()
    connection.cleanup()
    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(windowRemove).toHaveBeenCalledWith('online', expect.any(Function))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    connection.connectMqtt()
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('cancels a pending online reconnect during cleanup', async () => {
    connection.connectMqtt()
    FakeWebSocket.instances[0].open()
    window.dispatchEvent(new Event('online'))
    connection.cleanup()
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('reconnects once after a normal unexpected close', async () => {
    connection.connectMqtt()
    FakeWebSocket.instances[0].open()
    FakeWebSocket.instances[0].close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1].url).toBe('wss://dash.example/ws?token=secret')
  })

  it('ignores callbacks from a socket replaced by online recovery', async () => {
    connection.connectMqtt()
    const old = FakeWebSocket.instances[0]
    old.open()
    const oldOpen = old.onopen
    const oldClose = old.onclose
    const oldError = old.onerror
    const oldMessage = old.onmessage
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(500)
    const current = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    expect(current).not.toBe(old)
    current.open()
    current.onmessage?.({ data: JSON.stringify({ gt: 12, mqtt_connected: true }) })
    oldOpen?.()
    oldClose?.()
    oldError?.()
    oldMessage?.({ data: JSON.stringify({ gt: 999, mqtt_connected: false }) })
    expect(current.closeCalls).toBe(0)
    expect(connection.commandConnected.value).toBe(true)
    expect(mqttConnected.value).toBe(true)
    expect(state.value.gt).toBe(12)
    await vi.advanceTimersByTimeAsync(2500)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('ignores HTTP fallback results that finish after cleanup', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    connection.connectMqtt()
    state.value = { gt: 123 }
    connection.cleanup()
    finish({ ok: true, json: async () => ({ gt: 999, mqtt_connected: true }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.value.gt).toBe(123)
    expect(mqttConnected.value).toBe(false)
  })
  it('never replaces a newer socket snapshot with an older in-flight HTTP response', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    connection.connectMqtt()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.onmessage?.({ data: JSON.stringify({ gt: 42, mqtt_connected: true }) })
    finish({ ok: true, json: async () => ({ gt: 999, mqtt_connected: false }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.value.gt).toBe(42)
    expect(mqttConnected.value).toBe(true)
  })

  it('retires an HTTP result on online recovery even before new telemetry arrives', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    connection.connectMqtt()
    state.value = { gt: 42 }
    window.dispatchEvent(new Event('online'))
    finish({ ok: true, json: async () => ({ gt: 999, mqtt_connected: true }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.value.gt).toBe(42)
    expect(mqttConnected.value).toBe(false)
  })

  it('bounds private polls without overlap and retires even a fetch that ignores abort', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    connection.connectMqtt()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await vi.advanceTimersByTimeAsync(9000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1001)
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    finish({ ok: true, json: async () => ({ gt: 999, mqtt_connected: true }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.value.gt).toBe(1)
  })

  it('keeps command responses out of state and history, including retired socket responses', async () => {
    connection.connectMqtt()
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.onmessage?.({ data: JSON.stringify({ gt: 42, mqtt_connected: true }) })
    vi.mocked(addHistoryPoint).mockClear()
    const respond = socket.onmessage!
    respond({ data: JSON.stringify({ type: 'command_result', action: 'toggle', request_id: 'current', status: 'accepted' }) })
    expect(connection.commandResult.value?.request_id).toBe('current')
    expect(state.value.gt).toBe(42)
    expect(addHistoryPoint).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    respond({ data: JSON.stringify({ type: 'command_error', action: 'toggle', request_id: 'retired', error: 'rejected' }) })
    expect(connection.commandError.value).toBeNull()
  })

  it('keeps cached values in tiles but inserts a history gap for stale or disconnected snapshots', async () => {
    connection.connectMqtt()
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeWebSocket.instances[0]
    socket.open()
    for (const extra of [{ mqtt_connected: false }, { mqtt_connected: true, telemetry: { quality: 'stale' } }]) {
      socket.onmessage?.({ data: JSON.stringify({ gt: 42, ...extra }) })
      expect(state.value.gt).toBe(42)
      expect(addHistoryPoint).toHaveBeenLastCalledWith({})
    }
    socket.onmessage?.({ data: JSON.stringify({ gt: 0, mqtt_connected: true, telemetry: { quality: 'live' } }) })
    expect(addHistoryPoint).toHaveBeenLastCalledWith(expect.objectContaining({ gt: 0 }))
  })

  it('inserts an outage boundary even when the connection closes without a stale frame', async () => {
    connection.connectMqtt()
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.onmessage?.({ data: JSON.stringify({ gt: 42, mqtt_connected: true }) })
    vi.mocked(addHistoryPoint).mockClear()
    socket.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(addHistoryPoint).toHaveBeenCalledWith({})
    await vi.advanceTimersByTimeAsync(2000)
    const next = FakeWebSocket.instances[1]
    next.open()
    next.onmessage?.({ data: JSON.stringify({ gt: 12, mqtt_connected: true }) })
    expect(addHistoryPoint).toHaveBeenLastCalledWith(expect.objectContaining({ gt: 12 }))
  })

  it('bounds a stalled handshake and retries once without another browser event', async () => {
    connection.connectMqtt()
    const stalled = FakeWebSocket.instances[0]
    await vi.advanceTimersByTimeAsync(9999)
    expect(stalled.closeCalls).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2002)
    expect(stalled.closeCalls).toBe(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('clears the handshake deadline when the socket opens', async () => {
    connection.connectMqtt()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    await vi.advanceTimersByTimeAsync(11000)
    expect(socket.closeCalls).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(connection.commandConnected.value).toBe(true)
  })

  it('replaces the handshake deadline when online recovery replaces its socket', async () => {
    const timeouts = vi.spyOn(globalThis, 'setTimeout')
    connection.connectMqtt()
    const oldDeadline = timeouts.mock.calls.find(([, delay]) => delay === 10000)?.[0]
    expect(oldDeadline).toEqual(expect.any(Function))
    const old = FakeWebSocket.instances[0]
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(500)
    const current = FakeWebSocket.instances[1]
    // Even a stale queued timer must neither close this socket nor clear its deadline.
    ;(oldDeadline as () => void)()
    await vi.advanceTimersByTimeAsync(9500)
    expect(old.closeCalls).toBe(1)
    expect(current.closeCalls).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(current.closeCalls).toBe(1)
    connection.cleanup()
    await vi.advanceTimersByTimeAsync(12000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

})
