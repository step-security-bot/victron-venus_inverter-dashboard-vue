import { dashboardPageToken } from '../composables/useConnection'
import { apiUrl, isPublicMode } from '../config/publicMode'

export type NotificationPreferences = { native: boolean; ev: boolean; water: boolean; lowBattery: boolean }
export const DEFAULT_PREFERENCES: NotificationPreferences = { native: true, ev: true, water: true, lowBattery: true }
export type ServerStatus = { enabled: boolean; available: boolean; reason: string | null; publicKey: string | null; maxNotificationAgeSeconds: number; preferencesDefaults: NotificationPreferences }
export type SubscriptionStatus = { registered: boolean; preferences?: NotificationPreferences }

/** Never send the dashboard bearer token to a configured cross-origin API. */
export async function notificationApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const target = new URL(apiUrl(`/api/notifications/${path}`), window.location.origin)
  if (isPublicMode() || target.origin !== window.location.origin || target.search || target.hash || target.username || target.password) {
    throw new Error('System notifications require the same-origin dashboard backend.')
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = dashboardPageToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(target.href, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    })
    if (!response.ok || response.redirected) {
      if (response.status === 401 || response.status === 403) throw new Error('Dashboard authorization is required for notifications.')
      if (response.status === 429) throw new Error('Please wait before sending another test notification.')
      throw new Error('The notification server could not complete the request.')
    }
    return await response.json() as T
  } finally { clearTimeout(timeout) }
}
