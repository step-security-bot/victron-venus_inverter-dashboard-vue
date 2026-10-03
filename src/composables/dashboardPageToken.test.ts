import { afterEach, describe, expect, it, vi } from 'vitest'
import { dashboardPageToken } from './useConnection'

describe('dashboardPageToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads token from location.search', () => {
    vi.stubGlobal('location', { search: '?token=s3cret&x=1' })
    expect(dashboardPageToken()).toBe('s3cret')
  })

  it('returns null when token absent', () => {
    vi.stubGlobal('location', { search: '?x=1' })
    expect(dashboardPageToken()).toBeNull()
  })

  it('returns null for empty token', () => {
    vi.stubGlobal('location', { search: '?token=' })
    expect(dashboardPageToken()).toBeNull()
  })
})
