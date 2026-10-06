import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addHistoryPoint } from './useChart'
import { useConnection } from './useConnection'
import { mqttConnected, state } from './useInverterState'

vi.mock('../config/publicMode', () => ({
  apiUrl: (path: string) => path,
  gatewaySnapshotUrl: () => '/snapshot',
  isPublicMode: () => true,
}))
vi.mock('./useChart', () => ({ addHistoryPoint: vi.fn() }))

const snapshot = (power = 123) => ({ system: { '0/Ac/Grid/L1/Power': power } })
const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
let connection: ReturnType<typeof useConnection>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn().mockResolvedValue(response(snapshot()))
  vi.stubGlobal('fetch', fetchMock)
  mqttConnected.value = false
  connection = useConnection()
})
afterEach(() => {
  connection.cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function connect() {
  connection.connectMqtt()
  await vi.advanceTimersByTimeAsync(0)
  expect(mqttConnected.value).toBe(true)
  expect(state.value.gt).toBe(123)
}

describe('public snapshot freshness', () => {
  it('rejects redirects at fetch and keeps credentials on the same origin', async () => {
    await connect()
    expect(fetchMock).toHaveBeenCalledWith('/snapshot', expect.objectContaining({
      credentials: 'same-origin',
      redirect: 'error',
    }))
  })

  it.each([
    ['HTTP error', () => Promise.resolve(response(snapshot(999), false))],
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['null JSON', () => Promise.resolve(response(null))],
    ['array JSON', () => Promise.resolve(response([]))],
    ['redirected response', () => Promise.resolve({ ...response(snapshot(999)), redirected: true })],
    [
      'invalid JSON',
      () =>
        Promise.resolve({
          ok: true,
          json: async () => {
            throw new Error('JSON')
          },
        }),
    ],
  ])('expires after %s and recovers on valid telemetry', async (_name, failure) => {
    await connect()
    fetchMock.mockImplementation(failure)
    await vi.advanceTimersByTimeAsync(14999)
    expect(mqttConnected.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(mqttConnected.value).toBe(false)
    expect(state.value.gt).toBe(123)
    expect(addHistoryPoint).toHaveBeenLastCalledWith({})
    fetchMock.mockResolvedValue(response(snapshot(456)))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mqttConnected.value).toBe(true)
    expect(state.value.gt).toBe(456)
  })

  it.each([
    {},
    snapshot(Number.POSITIVE_INFINITY),
  ])('clears measurements removed by a complete snapshot', async (empty) => {
    await connect()
    fetchMock.mockResolvedValue(response(empty))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mqttConnected.value).toBe(false)
    expect(state.value.gt).toBeUndefined()
    fetchMock.mockResolvedValue(response(snapshot(0)))
    await vi.advanceTimersByTimeAsync(3000)
    expect(mqttConnected.value).toBe(true)
    expect(state.value.gt).toBe(0)
  })

  it('renews the deadline only when another valid snapshot arrives', async () => {
    await connect()
    await vi.advanceTimersByTimeAsync(12000)
    fetchMock.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(14999)
    expect(mqttConnected.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(mqttConnected.value).toBe(false)
  })

  it('expires during a hung request, aborts it and resumes polling', async () => {
    await connect()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    await vi.advanceTimersByTimeAsync(15000)
    expect(mqttConnected.value).toBe(false)
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true)
    fetchMock.mockResolvedValue(response(snapshot(456)))
    await vi.advanceTimersByTimeAsync(12000)
    expect(mqttConnected.value).toBe(true)
  })

  it('recovers from a fetch that ignores abort without accepting its late result', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    connection.connectMqtt()
    const oldSignal = fetchMock.mock.calls[0][1].signal
    await vi.advanceTimersByTimeAsync(12000)
    expect(oldSignal.aborted).toBe(true)
    expect(state.value.gt).toBe(123)
    finish(response(snapshot(999)))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.value.gt).toBe(123)
    expect(mqttConnected.value).toBe(true)
  })

  it('does not apply an in-flight response after cleanup', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    connection.connectMqtt()
    connection.cleanup()
    resolve(response(snapshot(999)))
    await vi.advanceTimersByTimeAsync(0)
    expect(mqttConnected.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event('online'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
