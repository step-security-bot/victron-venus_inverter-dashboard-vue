import { describe, expect, it } from 'vitest'
import {
  exactNotificationTime,
  formatNotificationAge,
  notificationTimestampMs,
} from './notificationTime'

describe('notification timestamp interpretation', () => {
  it.each([
    undefined,
    '',
    'bad',
    '0',
    '2026-10-05T11:47:00',
    '2026-02-30T12:00:00Z',
    '2026-10-05T24:00:00Z',
    '1970-01-01T00:00:00Z',
    '2026-13-01T00:00:00Z',
  ])('keeps malformed, timezone-less and sentinel %j unknown', (value) => {
    expect(notificationTimestampMs(value)).toBeNull()
    expect(formatNotificationAge(value, Date.now())).toBe('')
  })

  it('keeps timezone offsets equivalent and DST repeated hours distinct', () => {
    expect(notificationTimestampMs('2026-10-05T11:47:00-07:00')).toBe(
      notificationTimestampMs('2026-10-05T18:47:00Z')
    )
    const first = notificationTimestampMs('2026-11-01T01:30:00-07:00')
    const second = notificationTimestampMs('2026-11-01T01:30:00-08:00')
    expect(second! - first!).toBe(3_600_000)
  })

  it('does not substitute now for a valid future event', () => {
    const source = '2026-10-05T18:47:00Z'
    expect(formatNotificationAge(source, Date.parse(source) - 1000)).toBe(
      exactNotificationTime(Date.parse(source))
    )
  })
})
