/** Source event time, never the receipt time of a retained notification. */
export function notificationTimestampMs(value: string | undefined): number | null {
  if (!value) return null
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)
  if (!parts) return null
  const [, year, month, day, hour, minute, second] = parts.map(Number)
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

export function exactNotificationTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { timeZoneName: 'short' })
}

/** Relative event age in the same compact form as Victron GUIv2. */
export function formatNotificationAge(value: string | undefined, now: number): string {
  const ms = notificationTimestampMs(value)
  if (ms === null) return ''
  const elapsed = now - ms
  if (elapsed < 0) return exactNotificationTime(ms)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m ago` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d ago` : exactNotificationTime(ms)
}
