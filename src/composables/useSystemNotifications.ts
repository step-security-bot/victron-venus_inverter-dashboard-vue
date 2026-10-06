import { computed, ref } from 'vue'
import { isPublicMode } from '../config/publicMode'
import { DEFAULT_PREFERENCES, notificationApi, type NotificationPreferences, type ServerStatus, type SubscriptionStatus } from '../notifications/api'
import { applicationServerKey, isNotificationRegistration, registerNotificationWorker, subscriptionMatchesKey, workerRequest, type WorkerSettings } from '../notifications/browser'

const server = ref<ServerStatus | null>(null)
const permission = ref<NotificationPermission | 'unsupported'>('unsupported')
const optedIn = ref(false)
const registered = ref(false)
const preferences = ref<NotificationPreferences>({ ...DEFAULT_PREFERENCES })
const busy = ref(false)
const error = ref('')
const notice = ref('')
const supported = ref(false)
let registration: ServiceWorkerRegistration | null = null
let refreshPending: Promise<void> | null = null
let users = 0
let generation = 0
let workerGeneration = 0
let refreshAfterMutation = false

function updateSupport() {
  supported.value = !isPublicMode() && window.isSecureContext === true && 'Notification' in window &&
    'serviceWorker' in navigator && 'PushManager' in window
  permission.value = 'Notification' in window ? Notification.permission : 'unsupported'
  return supported.value
}

async function existingRegistration() {
  const result = await navigator.serviceWorker.getRegistration('/')
  return result && isNotificationRegistration(result) ? result : null
}

function invalidateRefresh() {
  generation++
  refreshPending = null
}

async function readSubscription(status: ServerStatus, currentRegistration: ServiceWorkerRegistration | null) {
  const snapshot = { optedIn: false, registered: false, generation: 0, error: '', preferences: undefined as NotificationPreferences | undefined }
  if (!currentRegistration) return snapshot
  const local = await workerRequest<WorkerSettings>(currentRegistration, { type: 'notification-settings-get' })
  snapshot.optedIn = local.enabled === true
  snapshot.generation = local.generation
  const subscription = await currentRegistration.pushManager.getSubscription()
  if (!subscription || !status.available || !status.enabled || !status.publicKey) return snapshot
  if (!subscriptionMatchesKey(subscription, applicationServerKey(status.publicKey))) {
    snapshot.error = 'The server notification key changed. Use Enable to renew this browser subscription.'
    return snapshot
  }
  const remote = await notificationApi<SubscriptionStatus>('subscription/status', 'POST', { endpoint: subscription.endpoint })
  snapshot.registered = remote.registered === true
  if (snapshot.registered) snapshot.preferences = remote.preferences
  return snapshot
}

async function refreshStatus() {
  if (busy.value) return
  if (refreshPending) return refreshPending
  const observedGeneration = generation
  const current = () => observedGeneration === generation && !busy.value
  const task = (async () => {
    if (!updateSupport()) return
    try {
      const status = await notificationApi<ServerStatus>('status')
      const nextRegistration = await existingRegistration()
      const snapshot = await readSubscription(status, nextRegistration)
      if (!current()) return
      server.value = status; registration = nextRegistration
      workerGeneration = snapshot.generation
      optedIn.value = snapshot.optedIn; registered.value = snapshot.registered; error.value = snapshot.error
      if (snapshot.preferences) preferences.value = { ...snapshot.preferences }
    } catch {
      if (!current()) return
      registered.value = false
      error.value = 'Notification status could not be verified. Retry when the dashboard is reachable.'
    }
  })().finally(() => { if (refreshPending === task) refreshPending = null })
  refreshPending = task
  return task
}

function workerChanged(event: MessageEvent) {
  if (event.data?.type !== 'notification-settings-changed') return
  invalidateRefresh()
  if (busy.value) refreshAfterMutation = true
  else void refreshStatus()
}
function visibilityChanged() {
  if (document.visibilityState === 'visible') void refreshStatus()
}

async function finishMutation() {
  busy.value = false
  if (!refreshAfterMutation) return
  refreshAfterMutation = false
  const actionError = error.value
  const observedGeneration = generation
  await refreshStatus()
  if (actionError && observedGeneration === generation && !busy.value) error.value = actionError
}

/** No permission request or subscription is created during application startup. */
export function initSystemNotifications(): () => void {
  users++
  if (users === 1) {
    void refreshStatus()
    navigator.serviceWorker?.addEventListener('message', workerChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
  }
  return () => {
    users = Math.max(0, users - 1)
    if (users === 0) {
      navigator.serviceWorker?.removeEventListener('message', workerChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }
}

async function renewSubscription(currentRegistration: ServiceWorkerRegistration, existing: PushSubscription) {
  const deleted = await notificationApi<SubscriptionStatus>('subscription', 'DELETE', { endpoint: existing.endpoint })
  if (deleted.registered !== false) throw new Error('Old subscription deletion unconfirmed')
  if (!await existing.unsubscribe() && await currentRegistration.pushManager.getSubscription()) throw new Error('Old subscription remains active')
}

async function changeWorkerSettings(currentRegistration: ServiceWorkerRegistration, request: Record<string, unknown>) {
  const result = await workerRequest<WorkerSettings>(currentRegistration, request)
  workerGeneration = result.generation
  optedIn.value = result.enabled === true
  if (!result.applied) throw new Error('A newer notification choice superseded this operation')
  return result.generation
}

/** Called only by the Enable button; requestPermission runs before any await. */
async function enable() {
  if (busy.value || !updateSupport() || !server.value?.available || !server.value.enabled) return
  if (permission.value === 'denied') return
  const expectedGeneration = workerGeneration
  invalidateRefresh()
  busy.value = true; error.value = ''; notice.value = ''
  try {
    permission.value = permission.value === 'default' ? await Notification.requestPermission() : permission.value
    if (permission.value !== 'granted') return
    registration = await registerNotificationWorker()
    const operation = await changeWorkerSettings(registration, { type: 'notification-settings-begin', generation: expectedGeneration })
    registered.value = false
    let existing = await registration.pushManager.getSubscription()
    const publicKey = server.value.publicKey
    if (!publicKey) throw new Error('Missing public key')
    const key = applicationServerKey(publicKey)
    if (existing && !subscriptionMatchesKey(existing, key)) {
      await renewSubscription(registration, existing)
      existing = null
    }
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    if (!subscriptionMatchesKey(subscription, key)) throw new Error('Subscription key mismatch')
    const result = await notificationApi<SubscriptionStatus>('subscription', 'POST', { subscription: subscription.toJSON(), preferences: preferences.value })
    if (result.registered !== true) throw new Error('Registration unconfirmed')
    await changeWorkerSettings(registration, { type: 'notification-settings-set', enabled: true, generation: operation })
    optedIn.value = true; registered.value = true
    if (result.preferences) preferences.value = { ...result.preferences }
  } catch {
    registered.value = false
    error.value = 'Notifications were not enabled. The server registration or browser setup failed; retry to complete it.'
  } finally { await finishMutation() }
}

async function disable() {
  if (busy.value) return
  invalidateRefresh()
  busy.value = true; error.value = ''; notice.value = ''
  try {
    registration ??= await existingRegistration() ?? await registerNotificationWorker()
    // Stop local display immediately, even if deleting on the server needs a retry.
    await changeWorkerSettings(registration, { type: 'notification-settings-set', enabled: false })
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      const result = await notificationApi<SubscriptionStatus>('subscription', 'DELETE', { endpoint: subscription.endpoint })
      if (result.registered !== false) throw new Error('Deletion unconfirmed')
      if (!await subscription.unsubscribe() && await registration.pushManager.getSubscription()) throw new Error('Unsubscribe failed')
    }
    registered.value = false
    notice.value = 'Notifications disabled on this browser.'
  } catch {
    error.value = 'Disabling is incomplete. Retry Disable to remove the server subscription and browser registration.'
  } finally { await finishMutation() }
}

async function savePreferences() {
  if (busy.value || !registered.value || !optedIn.value) return
  invalidateRefresh()
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) throw new Error('Subscription missing')
    const result = await notificationApi<SubscriptionStatus>('subscription', 'POST', { subscription: subscription.toJSON(), preferences: preferences.value })
    if (!result.registered) throw new Error('Registration unconfirmed')
    notice.value = 'Notification categories saved.'
  } catch { error.value = 'Notification categories were not saved. Retry when the dashboard is reachable.' }
  finally { await finishMutation() }
}

async function test() {
  if (busy.value || !registered.value || !optedIn.value || permission.value !== 'granted') return
  invalidateRefresh()
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) throw new Error('Subscription missing')
    const result = await notificationApi<{ queued: boolean }>('test', 'POST', { endpoint: subscription.endpoint })
    if (result.queued !== true) throw new Error('Test unconfirmed')
    notice.value = 'Test queued. Check your system notifications; delivery has not yet been confirmed.'
  } catch { error.value = 'The test could not be queued. Check the connection, or wait a minute before retrying.' }
  finally { await finishMutation() }
}

export function useSystemNotifications() {
  const ready = computed(() => supported.value && permission.value === 'granted' && optedIn.value && registered.value && server.value?.available === true)
  const status = computed(() => {
    if (!supported.value) return 'Unavailable in this browser or connection'
    if (permission.value === 'denied') return 'Blocked by browser permission'
    if (!server.value?.enabled || !server.value.available) return 'Server push unavailable'
    if (ready.value) return 'Enabled — server registration confirmed'
    if (optedIn.value) return 'Registration needs verification'
    return 'Off'
  })
  return { supported, permission, optedIn, registered, preferences, busy, error, notice, server, ready, status, enable, disable, test, savePreferences, refresh: refreshStatus }
}
