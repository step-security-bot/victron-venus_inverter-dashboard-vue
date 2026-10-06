export const WORKER_PATH = '/notifications-sw.js'
export type WorkerSettings = { enabled: boolean; generation: number; applied: boolean }

export async function workerRequest<T>(registration: ServiceWorkerRegistration, request: Record<string, unknown>): Promise<T> {
  const worker = registration.active
  const script = worker ? new URL(worker.scriptURL) : null
  if (!worker || script?.pathname !== WORKER_PATH || script.origin !== location.origin || script.search || script.hash) {
    throw new Error('The notification worker is not ready. Reload this page and try again.')
  }
  return await new Promise<T>((resolve, reject) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('The notification worker did not respond.')) }, 5000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout); channel.port1.close()
      if (event.data?.ok === true) resolve(event.data.result as T)
      else reject(new Error('Notification storage is unavailable in this browser.'))
    }
    try { worker.postMessage(request, [channel.port2]) }
    catch { clearTimeout(timeout); channel.port1.close(); reject(new Error('The notification worker could not receive the request.')) }
  })
}

export function isNotificationRegistration(registration: ServiceWorkerRegistration): boolean {
  return registration.scope === `${location.origin}/` && registration.active?.scriptURL === new URL(WORKER_PATH, location.origin).href
}

export function subscriptionMatchesKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  const actual = subscription.options?.applicationServerKey
  if (actual?.byteLength !== expected.byteLength) return false
  return new Uint8Array(actual).every((value, index) => value === expected[index])
}

export async function registerNotificationWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(WORKER_PATH, { scope: '/', updateViaCache: 'none' })
  const worker = registration.installing ?? registration.waiting
  if (worker) {
    const activating = worker
    if (activating.scriptURL !== new URL(WORKER_PATH, location.origin).href) throw new Error('Unexpected notification worker')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { activating.removeEventListener('statechange', changed); reject(new Error('The notification worker did not activate.')) }, 10_000)
      function changed() {
        if (activating.state === 'activated' || activating.state === 'redundant') {
          clearTimeout(timer); activating.removeEventListener('statechange', changed)
          if (activating.state === 'activated') resolve()
          else reject(new Error('The notification worker could not activate.'))
        }
      }
      activating.addEventListener('statechange', changed)
      changed()
    })
  }
  if (!isNotificationRegistration(registration)) throw new Error('The notification worker is not active at the dashboard root.')
  return registration
}

export function applicationServerKey(encoded: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(encoded)) throw new Error('The notification server supplied an invalid public key.')
  const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '=')
  if (decoded.length !== 65 || decoded.codePointAt(0) !== 4) throw new Error('The notification server supplied an invalid public key.')
  return Uint8Array.from(decoded, (character) => character.codePointAt(0) ?? 0)
}
