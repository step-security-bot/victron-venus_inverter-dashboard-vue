import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import { mqttConnected, state } from './composables/useInverterState'

vi.mock('./composables/useChart', () => ({
  addHistoryPoint: vi.fn(),
  useChart: () => ({ chartOption: {}, forceUpdateChart: vi.fn() }),
}))
vi.mock('./composables/useSystemNotifications', () => ({ initSystemNotifications: vi.fn() }))
vi.mock('./config/publicMode', () => ({
  apiUrl: (path: string) => path, gatewaySnapshotUrl: () => '/snapshot', isPublicMode: () => false,
}))

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

const now = new Date('2026-10-05T22:00:00Z')
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
  state.value = {
    data_source: 'igw', gateway_connected: true, dry_run: false,
    controller_controls_available: true, ess_mode_controls_available: true,
    ess_mode: { selected: 'external_control', selection_supported: true },
    ess_mode_observed_at: now.getTime() / 1000 - 29.8,
  }
  mqttConnected.value = true
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
  state.value = {}
  mqttConnected.value = false
})

async function openMenu() {
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        BatterySolarPanel: true, CameraPopup: true, ChartPanel: true,
        DailyStats: true, LoadsTable: true, NotificationBanner: true,
        NotificationHistory: true, SettingsDrawer: true, SidePanel: true,
        StatCards: true, StatusBar: true,
      },
    },
  })
  FakeSocket.latest.readyState = FakeSocket.OPEN
  FakeSocket.latest.onopen?.()
  await nextTick()
  await wrapper.get('[aria-haspopup="menu"]').trigger('click')
  await flushPromises()
  return document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!
}

describe('ESS local send refusal feedback', () => {
  it('accepts a fresh observation received while the background clock tick is delayed', async () => {
    const off = await openMenu()
    // A background tab can receive state while its one-second timer is throttled.
    vi.setSystemTime(new Date(now.getTime() + 10_000))
    FakeSocket.latest.onmessage?.({ data: JSON.stringify({
      ...state.value, ess_mode_observed_at: Date.now() / 1000 - 2,
    }) })
    await flushPromises()
    expect(off.getAttribute('aria-disabled')).toBe('false')
    expect(document.body.textContent).not.toContain('Waiting for fresh ESS status')
    expect(FakeSocket.latest.send).not.toHaveBeenCalled()

    // The same live-clock calculation must continue rejecting future timestamps.
    FakeSocket.latest.onmessage?.({ data: JSON.stringify({
      ...state.value, ess_mode_observed_at: Date.now() / 1000 + 1,
    }) })
    await flushPromises()
    expect(off.getAttribute('aria-disabled')).toBe('true')
    expect(FakeSocket.latest.send).not.toHaveBeenCalled()
  })

  it('expires a displayed observation on the clock tick without a new state message', async () => {
    const off = await openMenu()
    expect(off.getAttribute('aria-disabled')).toBe('false')
    await vi.advanceTimersByTimeAsync(1000)
    expect(off.getAttribute('aria-disabled')).toBe('true')
    expect(FakeSocket.latest.send).not.toHaveBeenCalled()
  })

  it('immediately rejects a selection that expires between the display tick and send', async () => {
    const off = await openMenu()
    expect(off.getAttribute('aria-disabled')).toBe('false')
    // Date changes without running the one-second display refresh timer.
    vi.setSystemTime(new Date(now.getTime() + 500))
    off.click()
    await flushPromises()
    expect(FakeSocket.latest.send).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Waiting for the controller')
    expect(document.body.textContent).toContain('No change was sent.')
  })

  it.each([2, 3])('immediately rejects socket state %s before its close event updates the UI', async (socketState) => {
    const off = await openMenu()
    expect(off.getAttribute('aria-disabled')).toBe('false')
    FakeSocket.latest.readyState = socketState
    off.click()
    await flushPromises()
    expect(FakeSocket.latest.send).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Waiting for the controller')
    expect(document.body.textContent).toContain('No change was sent.')
  })

  it('catches a local socket send exception without leaking its details', async () => {
    const off = await openMenu()
    FakeSocket.latest.send.mockImplementationOnce(() => { throw new Error('private transport details') })
    off.click()
    await flushPromises()
    expect(document.body.textContent).not.toContain('Waiting for the controller')
    expect(document.body.textContent).not.toContain('private transport details')
    expect(document.body.textContent).toContain('No change was sent.')
    expect(state.value.ess_mode?.selected).toBe('external_control')
  })

  it('keeps an actually sent command pending until its live correlated acknowledgement', async () => {
    const off = await openMenu()
    off.click()
    await flushPromises()
    const message = JSON.parse(FakeSocket.latest.send.mock.calls[0]![0] as string)
    expect(message.action).toBe('set_ess_mode')
    expect(document.body.textContent).toContain('Waiting for the controller')
    state.value = { ...state.value, ess_mode: { ...state.value.ess_mode, selected: 'off', request_id: message.request_id } }
    await flushPromises()
    expect(document.body.textContent).not.toContain('Waiting for the controller')
    expect(document.body.textContent).not.toContain('No change was sent.')
  })
})
