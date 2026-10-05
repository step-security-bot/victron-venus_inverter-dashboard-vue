import { ref, watch } from 'vue'
import { isPublicMode } from '../config/publicMode'
import { notificationTimestampMs } from '../notificationTime'
import { state } from './useInverterState'

// Banner + history notifications fed from the notifications[] array that
// both dashboards broadcast (inverter/notifications pushes + Victron alarm
// transitions, cleared server-side when an alarm returns to 0).
// Logic ported from inverter-desktop's useInverterState.

export interface BannerNotification {
  id: string
  level: 'info' | 'warning' | 'alarm'
  title: string
  body: string
  source?: string
  ts?: string
}

export interface HistoryEntry extends BannerNotification {
  timestamp: number | null
  read: boolean
}

const MAX_HISTORY = 100

export const bannerNotifications = ref<BannerNotification[]>([])
export const historyNotifications = ref<HistoryEntry[]>([])

/** Optional WS/command sender injected by App (IGW / MQTT ack path). */
let sendCommand: ((action: string, payload?: Record<string, unknown>) => void) | null = null

/** Wire the dashboard connection send() so dismiss can ack on Cerbo via IGW. */
export function setNotificationCommandSender(
  fn: ((action: string, payload?: Record<string, unknown>) => void) | null
) {
  sendCommand = fn
}

// ---------------------------------------------------------------------------
// Dismissal persistence — dismissed banners stay hidden until a new id arrives
// ---------------------------------------------------------------------------

const DISMISSED_KEY = 'dismissed_banner_ids'
const MAX_DISMISSED = 200

function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

const dismissedIds = loadDismissedIds()

function saveDismissedIds() {
  const arr = [...dismissedIds].slice(-MAX_DISMISSED)
  dismissedIds.clear()
  for (const id of arr) dismissedIds.add(id)
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr))
  } catch {
    /* private mode etc. — dismissals just won't persist */
  }
}

/**
 * User dismissed the banner (X) — same UX as inverter-desktop.
 * Asks the dashboard backend to drop the id and, for Victron platform
 * banners, AcknowledgeAll on Cerbo (IGW command or LAN MQTT).
 * Non-platform ids stay locally dismissed until a fresh id arrives.
 */
export function dismissBanner(id: string) {
  clearBanner(id)
  // Public / here.now: local dismiss only — never ack Cerbo.
  if (isPublicMode()) {
    dismissedIds.add(id)
    saveDismissedIds()
    return
  }
  // Match inverter-desktop / go WS handlers: platform → AcknowledgeAll,
  // other Victron alarms → SilenceAlarm. Do not send dismiss_notification
  // (unknown to go/IGW). Non-Victron banners stay local-only.
  if (id.startsWith('victron-platform-')) {
    sendCommand?.('acknowledge_all_notifications', { id })
    // Cerbo ack is server-side; do not persist platform ids in localStorage —
    // desktop uses Rust user_dismissed until Active clears.
    return
  }
  if (id.startsWith('victron-')) {
    sendCommand?.('silence_alarm', { id })
  }
  dismissedIds.add(id)
  saveDismissedIds()
}

/** Add or replace by id (dedupe for re-published notifications). */
export function upsertBanner(notification: BannerNotification) {
  if (dismissedIds.has(notification.id)) return
  const idx = bannerNotifications.value.findIndex((b) => b.id === notification.id)
  if (idx >= 0) {
    bannerNotifications.value[idx] = notification
  } else {
    bannerNotifications.value = [...bannerNotifications.value, notification]
  }
}

/** Alarm resolved / removed upstream — drop without recording a dismissal. */
export function clearBanner(id: string) {
  bannerNotifications.value = bannerNotifications.value.filter((b) => b.id !== id)
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

export function markNotificationRead(id: string, timestamp?: number | null) {
  const entry = historyNotifications.value.find(
    (n) => n.id === id && (timestamp === undefined || n.timestamp === timestamp)
  )
  if (entry) entry.read = true
}

export function markAllNotificationsRead() {
  for (const n of historyNotifications.value) n.read = true
}

export function clearNotifications() {
  historyNotifications.value = []
}

export function unreadNotificationCount(): number {
  return historyNotifications.value.filter((n) => !n.read).length
}

// ---------------------------------------------------------------------------
// Server sync
// ---------------------------------------------------------------------------

function normalize(n: {
  id: string
  level: string
  title: string
  body?: string
  source?: string
  ts?: string
}): BannerNotification {
  return {
    id: n.id,
    level: n.level === 'alarm' || n.level === 'warning' ? n.level : 'info',
    title: n.title,
    body: n.body || '',
    source: n.source,
    ts: n.ts,
  }
}

// Per-tab replay memory is bounded independently of the visible 100-row history.
// Remember the last 4096 observed identities, including cleared/absent events.
// Beyond this window (or after a page reload), a replay may be recorded again.
const MAX_SEEN_EVENTS = 4096
const seenEventTimes = new Map<string, number | null>()
const seenEvents = new Set<string>()

function eventKey(id: string, timestamp: number | null): string {
  return JSON.stringify([id, timestamp])
}

function syncHistory(incoming: BannerNotification[]) {
  const fresh: HistoryEntry[] = []
  for (const n of incoming) {
    if (!n.id) continue
    const timestamp = notificationTimestampMs(n.ts)
    const previous = seenEventTimes.get(n.id)
    const key = eventKey(n.id, timestamp)
    const entries = [...fresh, ...historyNotifications.value]
    const entry = entries.find((h) => h.id === n.id && h.timestamp === timestamp)
    // DateTime may follow Description, even within the same snapshot. Complete
    // the original entry without making it unread again or replacing its time
    // with a browser receipt time.
    const pending =
      previous === null && timestamp !== null
        ? entries.find((h) => h.id === n.id && h.timestamp === null)
        : undefined
    if (entry) {
      Object.assign(entry, n, { timestamp })
    } else if (pending) {
      Object.assign(pending, n, { timestamp })
    } else if (!seenEvents.has(key) && (timestamp !== null || !seenEventTimes.has(n.id))) {
      fresh.push({ ...n, timestamp, read: false })
    }
    // Remember cleared occurrences too: reordered/replayed snapshots must not
    // refill cleared history. Unknown reconnects never erase a known time.
    seenEvents.delete(key)
    seenEvents.add(key)
    seenEventTimes.delete(n.id)
    seenEventTimes.set(n.id, timestamp ?? previous ?? null)
    while (seenEvents.size > MAX_SEEN_EVENTS) {
      seenEvents.delete(seenEvents.values().next().value!)
    }
    while (seenEventTimes.size > MAX_SEEN_EVENTS) {
      seenEventTimes.delete(seenEventTimes.keys().next().value!)
    }
  }
  historyNotifications.value = [...fresh, ...historyNotifications.value].slice(0, MAX_HISTORY)
}

watch(
  () => state.value.notifications,
  (list) => {
    const incoming = list || []
    const ids = new Set(incoming.map((n) => n.id))

    for (const n of incoming) upsertBanner(normalize(n))
    // Server dropped ids (alarm cleared / ring eviction) -> close their banners.
    for (const b of [...bannerNotifications.value]) {
      if (!ids.has(b.id)) clearBanner(b.id)
    }

    syncHistory(incoming.map(normalize))
  }
)
