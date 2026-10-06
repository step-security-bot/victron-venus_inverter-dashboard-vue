import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerNotificationWorker } from './browser'
afterEach(() => { vi.unstubAllGlobals() })
describe('notification worker activation', () => {
  it('waits for the exact new worker instead of trusting an old active root worker', async () => {
    let changed: (() => void) | undefined
    const worker = { state: 'installing', scriptURL: location.origin + '/notifications-sw.js', addEventListener: (_name: string, listener: () => void) => { changed = listener }, removeEventListener: vi.fn() }
    const registration = { scope: location.origin + '/', active: { scriptURL: location.origin + '/old-worker.js' }, installing: worker }
    const register = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    let complete = false
    const pending = registerNotificationWorker().then((result) => { complete = true; return result })
    await Promise.resolve(); await Promise.resolve()
    expect(complete).toBe(false)
    worker.state = 'activated'; registration.active = worker; changed?.()
    expect(await pending).toBe(registration)
    expect(register).toHaveBeenCalledWith('/notifications-sw.js', { scope: '/', updateViaCache: 'none' })
  })
  it('rejects a foreign script or scope before reporting notification readiness', async () => {
    const register = vi.fn().mockResolvedValue({ scope: location.origin + '/other/', active: { scriptURL: location.origin + '/notifications-sw.js' } })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    await expect(registerNotificationWorker()).rejects.toThrow('dashboard root')
  })
})
