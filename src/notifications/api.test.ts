import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationApi } from './api'
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue({ ok: true, redirected: false, json: async () => ({ available: true }) })
  window.history.replaceState({}, '', '/?token=dashboard-secret')
  delete window.__INVERTER_PUBLIC__
})
afterEach(() => { vi.unstubAllGlobals(); delete window.__INVERTER_PUBLIC__; window.history.replaceState({}, '', '/') })
describe('notification API transport', () => {
  it('sends auth only in a same-origin header and subscription only in the JSON body', async () => {
    await notificationApi('subscription/status', 'POST', { endpoint: 'https://push.example/capability' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(new URL(url).search).toBe('')
    expect(url).not.toContain('dashboard-secret')
    expect(options.headers.Authorization).toBe('Bearer dashboard-secret')
    expect(options.body).toBe(JSON.stringify({ endpoint: 'https://push.example/capability' }))
    expect(options).toMatchObject({ redirect: 'error', cache: 'no-store', credentials: 'same-origin' })
  })
  it('refuses public mode and cross-origin API bases before transmitting secrets', async () => {
    window.__INVERTER_PUBLIC__ = { apiBase: 'https://foreign.example' }
    await expect(notificationApi('status')).rejects.toThrow('same-origin')
    window.__INVERTER_PUBLIC__ = true
    await expect(notificationApi('status')).rejects.toThrow('same-origin')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not parse or reflect private server error bodies', async () => {
    const json = vi.fn()
    fetchMock.mockResolvedValue({ ok: false, status: 500, json })
    await expect(notificationApi('status')).rejects.toThrow('could not complete')
    expect(json).not.toHaveBeenCalled()
  })
})
