import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ api: vi.fn(), worker: vi.fn(), register: vi.fn(), getRegistration: vi.fn(), getSubscription: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), requestPermission: vi.fn(), enabled: false, generation: 0 }))
vi.mock('../notifications/api', async (original) => ({ ...await original<typeof import('../notifications/api')>(), notificationApi: mocks.api }))
vi.mock('../notifications/browser', async (original) => ({ ...await original<typeof import('../notifications/browser')>(), registerNotificationWorker: mocks.register, workerRequest: mocks.worker }))
const endpoint = 'https://push.example/private-capability'
const key = Uint8Array.from(atob('B' + 'A'.repeat(86) + '='), (character) => character.charCodeAt(0)).buffer
const subscription = { options: { applicationServerKey: key }, endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: mocks.unsubscribe }
const registration = { scope: location.origin + '/', active: { scriptURL: location.origin + '/notifications-sw.js' }, pushManager: { getSubscription: mocks.getSubscription, subscribe: mocks.subscribe } }
const status = { enabled: true, available: true, publicKey: 'B' + 'A'.repeat(86), preferencesDefaults: { native: true, ev: true, water: true, lowBattery: true } }
let module: typeof import('./useSystemNotifications')
let cleanup: (() => void) | undefined
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.enabled = false; mocks.generation = 0
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: mocks.requestPermission })
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: mocks.getRegistration, addEventListener: vi.fn(), removeEventListener: vi.fn() } })
  mocks.getRegistration.mockResolvedValue(undefined)
  mocks.register.mockResolvedValue(registration)
  mocks.getSubscription.mockResolvedValue(subscription)
  mocks.subscribe.mockResolvedValue(subscription)
  mocks.unsubscribe.mockResolvedValue(true)
  mocks.requestPermission.mockResolvedValue('granted')
  mocks.worker.mockImplementation(async (_registration, message) => {
    let applied = true
    if (message.type === 'notification-settings-begin' || message.enabled === true) applied = message.generation === mocks.generation
    if (applied && (message.type === 'notification-settings-begin' || message.enabled === false)) { mocks.generation++; mocks.enabled = false }
    else if (applied && message.enabled === true) mocks.enabled = true
    return { enabled: mocks.enabled, generation: mocks.generation, applied }
  })
  mocks.api.mockImplementation(async (path, method) => {
    if (path === 'status') return status
    if (path === 'test') return { queued: true }
    return { registered: method !== 'DELETE', preferences: status.preferencesDefaults }
  })
  module = await import('./useSystemNotifications')
})
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals() })

describe('opt-in system notifications', () => {
  it('never prompts, subscribes or emits OS notifications during startup', async () => {
    cleanup = module.initSystemNotifications()
    await module.useSystemNotifications().refresh()
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(module.useSystemNotifications().ready.value).toBe(false)
  })
  it('requests permission directly on enable, before asynchronous browser setup', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh()
    const enabling = ui.enable()
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
    expect(mocks.register).not.toHaveBeenCalled()
    await enabling
    expect(ui.ready.value).toBe(true)
    expect(mocks.api).toHaveBeenCalledWith('subscription', 'POST', expect.objectContaining({ subscription: subscription.toJSON() }))
  })
  it('does not claim ready if server registration is refused', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh()
    mocks.api.mockResolvedValue({ registered: false })
    await ui.enable()
    expect(ui.ready.value).toBe(false)
    expect(mocks.enabled).toBe(false)
    expect(ui.error.value).toContain('not enabled')
  })
  it('does not loop a denied permission request', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: mocks.requestPermission })
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable()
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(ui.status.value).toContain('Blocked')
  })
  it('fails softly for insecure or unsupported browser environments', async () => {
    vi.stubGlobal('isSecureContext', false)
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable()
    expect(mocks.api).not.toHaveBeenCalled()
    expect(mocks.requestPermission).not.toHaveBeenCalled()
    expect(ui.status.value).toContain('Unavailable')
  })
  it('reports queued rather than delivered when sending an explicit test', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable(); await ui.test()
    expect(mocks.api).toHaveBeenCalledWith('test', 'POST', { endpoint })
    expect(ui.notice.value).toContain('Test queued')
    expect(ui.notice.value).toContain('not yet been confirmed')
  })
  it('stops local display and retains a retry path when server deletion fails', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable()
    mocks.api.mockRejectedValue(new Error('private endpoint or token must not be reflected'))
    await ui.disable()
    expect(mocks.enabled).toBe(false)
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
    expect(ui.error.value).toContain('Retry Disable')
    expect(ui.error.value).not.toContain('private endpoint')
    mocks.api.mockResolvedValue({ registered: false })
    await ui.disable()
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    expect(ui.registered.value).toBe(false)
  })
  it('restores only a server-confirmed native subscription after reload', async () => {
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: mocks.requestPermission })
    mocks.getRegistration.mockResolvedValue(registration); mocks.enabled = true
    const ui = module.useSystemNotifications(); await ui.refresh()
    expect(ui.ready.value).toBe(true)
    expect(mocks.api).toHaveBeenCalledWith('subscription/status', 'POST', { endpoint })
    expect(mocks.requestPermission).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await Promise.resolve()
  expect(predicate()).toBe(true)
}

describe('notification lifecycle races and key rotation', () => {
  it('invalidates a pending status read when another tab changes worker settings', async () => {
    cleanup = module.initSystemNotifications()
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable()
    mocks.getRegistration.mockResolvedValue(registration)
    const changed = vi.mocked(navigator.serviceWorker.addEventListener).mock.calls.find(([type]) => type === 'message')?.[1] as (event: MessageEvent) => void
    const pending = deferred<{ registered: boolean }>(); let queries = 0
    mocks.api.mockImplementation(async (path) => {
      if (path === 'status') return status
      if (path === 'subscription/status' && ++queries === 1) return pending.promise
      return { registered: false }
    })
    const stale = ui.refresh(); await until(() => queries === 1)
    mocks.enabled = false; mocks.generation++
    changed({ data: { type: 'notification-settings-changed' } } as MessageEvent)
    await until(() => queries === 2)
    pending.resolve({ registered: true }); await stale; await ui.refresh()
    expect(ui.optedIn.value).toBe(false)
    expect(ui.ready.value).toBe(false)
  })
  it('preserves the action failure after a queued worker resynchronization', async () => {
    cleanup = module.initSystemNotifications()
    const ui = module.useSystemNotifications(); await ui.refresh()
    mocks.getRegistration.mockResolvedValue(registration)
    const changed = vi.mocked(navigator.serviceWorker.addEventListener).mock.calls.find(([type]) => type === 'message')?.[1] as (event: MessageEvent) => void
    const original = mocks.worker.getMockImplementation()!
    mocks.worker.mockImplementation(async (...args) => {
      if (args[1].enabled === true) throw new Error('Storage failed after server registration')
      const result = await original(...args)
      if (args[1].type === 'notification-settings-begin') changed({ data: { type: 'notification-settings-changed' } } as MessageEvent)
      return result
    })
    await ui.enable()
    expect(mocks.enabled).toBe(false)
    expect(ui.ready.value).toBe(false)
    expect(ui.error.value).toContain('not enabled')
  })
  it('resynchronizes a Disable broadcast received while an older Enable reply is pending', async () => {
    cleanup = module.initSystemNotifications()
    const first = module.useSystemNotifications(); await first.refresh()
    const changed = vi.mocked(navigator.serviceWorker.addEventListener).mock.calls.find(([type]) => type === 'message')?.[1] as (event: MessageEvent) => void
    vi.resetModules()
    const second = (await import('./useSystemNotifications')).useSystemNotifications()
    mocks.getRegistration.mockResolvedValue(registration)
    await second.refresh()
    const reply = deferred<{ enabled: boolean; generation: number; applied: boolean }>()
    const original = mocks.worker.getMockImplementation()!
    let committed = false
    mocks.worker.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (args[1].enabled === true) { committed = true; return reply.promise }
      return result
    })
    const enabling = first.enable(); await until(() => committed)
    await second.disable()
    changed({ data: { type: 'notification-settings-changed' } } as MessageEvent)
    reply.resolve({ enabled: true, generation: 1, applied: true }); await enabling
    expect(first.optedIn.value).toBe(false)
    expect(first.ready.value).toBe(false)
  })
  it('does not let an earlier Enable in another tab undo a completed Disable', async () => {
    const first = module.useSystemNotifications(); await first.refresh()
    vi.resetModules()
    const secondModule = await import('./useSystemNotifications')
    const second = secondModule.useSystemNotifications()
    mocks.getRegistration.mockResolvedValue(registration)
    await second.refresh()
    const pending = deferred<{ registered: boolean }>(); let posting = false
    mocks.api.mockImplementation(async (path, method) => {
      if (path === 'status') return status
      if (path === 'subscription' && method === 'POST') { posting = true; return pending.promise }
      return { registered: method !== 'DELETE' }
    })
    const enabling = first.enable(); await until(() => posting)
    await second.disable()
    expect(mocks.enabled).toBe(false)
    pending.resolve({ registered: true }); await enabling
    expect(mocks.enabled).toBe(false)
    expect(first.ready.value).toBe(false)
    expect(second.ready.value).toBe(false)
  })
  it('fences an earlier permission prompt even when Disable must create the shared worker', async () => {
    const first = module.useSystemNotifications(); await first.refresh()
    vi.resetModules()
    const second = (await import('./useSystemNotifications')).useSystemNotifications()
    await second.refresh()
    const permission = deferred<NotificationPermission>()
    mocks.requestPermission.mockReturnValue(permission.promise)
    const enabling = first.enable()
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1)
    await second.disable()
    expect(mocks.register).toHaveBeenCalledTimes(1)
    permission.resolve('granted'); await enabling
    expect(mocks.enabled).toBe(false)
    expect(first.ready.value).toBe(false)
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.api).not.toHaveBeenCalledWith('subscription', 'POST', expect.anything())
  })
  it('ignores an old negative subscription status arriving after Enable succeeds', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh()
    mocks.getRegistration.mockResolvedValue(registration)
    const old = deferred<{ registered: boolean }>(); let queried = false
    mocks.api.mockImplementation(async (path) => {
      if (path === 'status') return status
      if (path === 'subscription/status') { queried = true; return old.promise }
      return { registered: true }
    })
    const refreshing = ui.refresh(); await until(() => queried)
    await ui.enable()
    expect(ui.ready.value).toBe(true)
    old.resolve({ registered: false }); await refreshing
    expect(ui.ready.value).toBe(true)
  })
  it('ignores an old positive subscription status arriving after Disable finishes', async () => {
    const ui = module.useSystemNotifications(); await ui.refresh(); await ui.enable()
    mocks.getRegistration.mockResolvedValue(registration)
    const old = deferred<{ registered: boolean }>(); let queried = false
    mocks.api.mockImplementation(async (path, method) => {
      if (path === 'status') return status
      if (path === 'subscription/status') { queried = true; return old.promise }
      return { registered: method !== 'DELETE' }
    })
    const refreshing = ui.refresh(); await until(() => queried)
    await ui.disable()
    old.resolve({ registered: true }); await refreshing
    expect(ui.ready.value).toBe(false)
    expect(ui.optedIn.value).toBe(false)
    expect(ui.registered.value).toBe(false)
  })
  it('replaces a subscription bound to an old VAPID key only on explicit Enable', async () => {
    const changedKey = new Uint8Array(key.slice(0)); changedKey[64] = 1
    const publicKey = btoa(String.fromCharCode(...changedKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    mocks.getRegistration.mockResolvedValue(registration); mocks.enabled = true
    mocks.api.mockImplementation(async (path, method) => path === 'status' ? { ...status, publicKey } : { registered: method !== 'DELETE' })
    mocks.subscribe.mockResolvedValue({ ...subscription, options: { applicationServerKey: changedKey.buffer } })
    const ui = module.useSystemNotifications(); await ui.refresh()
    expect(ui.ready.value).toBe(false)
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
    expect(ui.error.value).toContain('key changed')
    await ui.enable()
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    expect(mocks.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: changedKey })
    expect(ui.ready.value).toBe(true)
  })
})
