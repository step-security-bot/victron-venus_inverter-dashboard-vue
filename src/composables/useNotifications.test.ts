import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// happy-dom + Node experimental localStorage is unreliable in CI shells —
// back it with a Map for the whole file.
const lsStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (lsStore.has(k) ? (lsStore.get(k) as string) : null),
  setItem: (k: string, v: string) => void lsStore.set(k, String(v)),
  removeItem: (k: string) => void lsStore.delete(k),
})

import { state } from './useInverterState'
import {
  bannerNotifications,
  clearBanner,
  dismissBanner,
  setNotificationCommandSender,
  historyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  upsertBanner,
} from './useNotifications'

function reset() {
  lsStore.clear()
  bannerNotifications.value = []
  historyNotifications.value = []
}

describe('useNotifications', () => {
  beforeEach(reset)

  it('upserts banners by id (dedupe)', () => {
    upsertBanner({ id: 'a', level: 'warning', title: 'T', body: '' })
    upsertBanner({ id: 'a', level: 'alarm', title: 'T2', body: 'B' })
    expect(bannerNotifications.value).toHaveLength(1)
    expect(bannerNotifications.value[0].level).toBe('alarm')
  })

  it('dismiss hides banner and persists across reload of module state', () => {
    dismissBanner('a')
    upsertBanner({ id: 'a', level: 'info', title: 'T', body: '' })
    expect(bannerNotifications.value).toHaveLength(0)
    expect(lsStore.get('dismissed_banner_ids')).toContain('"a"')
  })

  it('clearBanner removes without recording dismissal', () => {
    // fresh id: the dismissed-id Set lives at module scope across tests
    upsertBanner({ id: 'b', level: 'info', title: 'T', body: '' })
    clearBanner('b')
    upsertBanner({ id: 'b', level: 'info', title: 'T', body: '' })
    expect(bannerNotifications.value).toHaveLength(1)
  })

  it('syncs banners and history from state.notifications, closes cleared ids', async () => {
    state.value = { ...state.value, notifications: [{ id: 'n1', level: 'alarm', title: 'X' }] }
    await Promise.resolve()
    // watcher flush
    await new Promise((r) => setTimeout(r, 0))
    expect(bannerNotifications.value.map((b) => b.id)).toEqual(['n1'])
    expect(historyNotifications.value[0].title).toBe('X')
    expect(unreadNotificationCount()).toBe(1)

    // server clears n1 (alarm back to 0) -> banner closed, history kept
    state.value = { ...state.value, notifications: [] }
    await new Promise((r) => setTimeout(r, 0))
    expect(bannerNotifications.value).toHaveLength(0)
    expect(historyNotifications.value).toHaveLength(1)
  })

  it('read tracking works', () => {
    historyNotifications.value = [
      { id: 'h1', level: 'info', title: 't', body: '', timestamp: 1, read: false },
    ]
    expect(unreadNotificationCount()).toBe(1)
    markNotificationRead('h1')
    expect(unreadNotificationCount()).toBe(0)
    markAllNotificationsRead()
    expect(unreadNotificationCount()).toBe(0)
  })

  it('hydrates late DateTime and preserves its age/read state across repeated snapshots and reconnect', async () => {
    const source = '2026-10-05T11:47:00-07:00'
    const n = { id: 'event-time-late', level: 'alarm', title: 'Battery alarm' }
    const sync = async (ts?: string) => {
      state.value = { ...state.value, notifications: [{ ...n, ts }] }
      await nextTick()
    }
    await sync()
    expect(historyNotifications.value[0].timestamp).toBeNull()
    markNotificationRead(n.id)
    await sync(source)
    expect(historyNotifications.value).toHaveLength(1)
    expect(historyNotifications.value[0].timestamp).toBe(Date.parse(source))
    expect(historyNotifications.value[0].read).toBe(true)
    state.value = { ...state.value, notifications: [] }
    await nextTick()
    await sync('')
    await sync(source)
    expect(historyNotifications.value).toHaveLength(1)
    expect(historyNotifications.value[0].timestamp).toBe(Date.parse(source))
    expect(historyNotifications.value[0].read).toBe(true)
  })

  it('retains distinct events in a recycled slot and marks the selected occurrence read', async () => {
    const id = 'victron-platform-event-time-recycled'
    for (const ts of ['2026-10-05T18:47:00Z', '2026-10-05T19:47:00Z']) {
      state.value = {
        ...state.value,
        notifications: [{ id, ts, title: 'Battery alarm', level: 'alarm' }],
      }
      await nextTick()
    }
    expect(historyNotifications.value).toHaveLength(2)
    markNotificationRead(id, Date.parse('2026-10-05T18:47:00Z'))
    expect(historyNotifications.value.map((h) => h.read)).toEqual([false, true])
  })

  it('does not refill cleared history from an unchanged snapshot', async () => {
    const n = {
      id: 'event-time-cleared',
      ts: '2026-10-05T18:47:00Z',
      level: 'alarm',
      title: 'Battery alarm',
    }
    state.value = { ...state.value, notifications: [n] }
    await nextTick()
    historyNotifications.value = []
    state.value = { ...state.value, notifications: [{ ...n }] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(0)
  })

  it('deduplicates reordered occurrences and hydrates an unknown time within one snapshot', async () => {
    const id = 'event-time-batch'
    const n = { id, level: 'alarm', title: 'Battery alarm' }
    const first = { ...n, ts: '2026-10-05T18:47:00Z' }
    const second = { ...n, ts: '2026-10-05T19:47:00Z' }
    state.value = { ...state.value, notifications: [n, first, second] }
    await nextTick()
    expect(historyNotifications.value.map((h) => h.timestamp)).toEqual([
      Date.parse(first.ts),
      Date.parse(second.ts),
    ])
    markAllNotificationsRead()
    state.value = { ...state.value, notifications: [second, first] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(2)
    expect(unreadNotificationCount()).toBe(0)
    historyNotifications.value = []
    state.value = { ...state.value, notifications: [first, second] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(0)
  })

  it('records a new timed occurrence after an unknown-time entry was cleared', async () => {
    const n = { id: 'event-time-cleared-unknown', level: 'alarm', title: 'Old alarm' }
    state.value = { ...state.value, notifications: [n] }
    await nextTick()
    historyNotifications.value = []
    state.value = { ...state.value, notifications: [] }
    await nextTick()
    const next = { ...n, title: 'New alarm', ts: '2026-10-05T19:47:00Z' }
    state.value = { ...state.value, notifications: [next] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(1)
    expect(historyNotifications.value[0].timestamp).toBe(Date.parse(next.ts))
    state.value = { ...state.value, notifications: [{ ...next }] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(1)
  })

  it('refreshes metadata while source time remains unavailable without making history unread', async () => {
    const n = { id: 'event-time-unknown-metadata', level: 'alarm', title: 'Alarm', body: '' }
    state.value = { ...state.value, notifications: [n] }
    await nextTick()
    markNotificationRead(n.id)
    state.value = { ...state.value, notifications: [{ ...n, body: 'JBD Battery Chain 1' }] }
    await nextTick()
    expect(historyNotifications.value).toHaveLength(1)
    expect(historyNotifications.value[0]).toMatchObject({
      body: 'JBD Battery Chain 1',
      timestamp: null,
      read: true,
    })
  })

  it('remembers cleared absent events beyond the former 500-event compaction threshold', async () => {
    const n = {
      id: 'event-time-long-replay',
      level: 'alarm',
      title: 'Alarm',
      ts: '2026-10-05T18:47:00Z',
    }
    const sync = async (id: string) => {
      state.value = { ...state.value, notifications: [{ ...n, id }] }
      await nextTick()
    }
    await sync(n.id)
    historyNotifications.value = []
    for (let i = 0; i < 600; i++) await sync(`event-time-long-other-${i}`)
    await sync(n.id)
    expect(historyNotifications.value.find((h) => h.id === n.id)).toBeUndefined()
  })

  it('bounds per-tab replay memory to the last 4096 observed identities', async () => {
    const n = {
      id: 'event-time-retention-boundary',
      level: 'alarm',
      title: 'Alarm',
      ts: '2026-10-05T18:47:00Z',
    }
    const sync = async (id: string) => {
      state.value = { ...state.value, notifications: [{ ...n, id }] }
      await nextTick()
    }
    await sync(n.id)
    historyNotifications.value = []
    for (let i = 0; i < 4096; i++) await sync(`event-time-retention-other-${i}`)
    await sync(n.id)
    expect(historyNotifications.value.filter((h) => h.id === n.id)).toHaveLength(1)
    expect(historyNotifications.value[0].timestamp).toBe(Date.parse(n.ts))
  })

  it('acks platform banners via acknowledge_all_notifications (Cerbo / IGW)', () => {
    const sent: Array<{ action: string; payload?: Record<string, unknown> }> = []
    setNotificationCommandSender((action, payload) => {
      sent.push({ action, payload })
    })
    upsertBanner({ id: 'victron-platform-0-3', level: 'alarm', title: 'High cell', body: 'BMS' })
    dismissBanner('victron-platform-0-3')
    expect(bannerNotifications.value.find((b) => b.id === 'victron-platform-0-3')).toBeUndefined()
    expect(sent).toEqual([
      { action: 'acknowledge_all_notifications', payload: { id: 'victron-platform-0-3' } },
    ])
    // platform ids are not stored in local dismissed set
    expect(lsStore.get('dismissed_banner_ids') ?? '[]').not.toContain('victron-platform-0-3')
    setNotificationCommandSender(null)
  })

  it('silences non-platform Victron alarms and dismisses locally', () => {
    const sent: Array<{ action: string; payload?: Record<string, unknown> }> = []
    setNotificationCommandSender((action, payload) => {
      sent.push({ action, payload })
    })
    upsertBanner({
      id: 'victron-vebus-low-battery',
      level: 'alarm',
      title: 'Low battery',
      body: '',
    })
    dismissBanner('victron-vebus-low-battery')
    expect(sent).toEqual([
      { action: 'silence_alarm', payload: { id: 'victron-vebus-low-battery' } },
    ])
    expect(lsStore.get('dismissed_banner_ids')).toContain('victron-vebus-low-battery')
    setNotificationCommandSender(null)
  })

  it('dismisses control/grafana banners locally without WS command', () => {
    const sent: string[] = []
    setNotificationCommandSender((action) => {
      sent.push(action)
    })
    upsertBanner({ id: 'grafana-Foo-firing', level: 'warning', title: 'Foo', body: '' })
    dismissBanner('grafana-Foo-firing')
    expect(sent).toEqual([])
    expect(lsStore.get('dismissed_banner_ids')).toContain('grafana-Foo-firing')
    setNotificationCommandSender(null)
  })
})
