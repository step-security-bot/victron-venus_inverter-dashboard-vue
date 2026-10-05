import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { historyNotifications } from '../composables/useNotifications'
import { i18n } from '../i18n'
import NotificationHistory from './NotificationHistory.vue'

describe('NotificationHistory', () => {
  it('shows source time with timezone and does not invent a time for an incomplete event', async () => {
    const eventTime = Date.parse('2026-10-05T18:47:00Z')
    historyNotifications.value = [
      {
        id: 'timed',
        title: 'Earlier event',
        body: '',
        level: 'alarm',
        timestamp: eventTime,
        read: false,
      },
      {
        id: 'unknown',
        title: 'Incomplete event',
        body: '',
        level: 'alarm',
        timestamp: null,
        read: false,
      },
    ]
    const wrapper = mount(NotificationHistory, { global: { plugins: [i18n] } })
    try {
      await wrapper.get('button.classic-btn').trigger('click')
      expect(wrapper.text()).toContain('Event time unavailable')
      const expected = new Date(eventTime).toLocaleString(undefined, { timeZoneName: 'short' })
      expect(wrapper.findAll('[title]').map((element) => element.attributes('title'))).toContain(
        expected
      )
    } finally {
      wrapper.unmount()
      historyNotifications.value = []
    }
  })

  it('marks a notification read through a native focusable button', async () => {
    historyNotifications.value = [
      {
        id: 'keyboard-test',
        title: 'Battery update',
        body: 'Charge complete',
        level: 'info',
        timestamp: Date.now(),
        read: false,
      },
    ]
    const wrapper = mount(NotificationHistory, { global: { plugins: [i18n] } })
    await wrapper.get('button.classic-btn').trigger('click')
    const notification = wrapper.get('button.text-left')
    expect(notification.element).toBeInstanceOf(HTMLButtonElement)
    expect(notification.attributes('type')).toBe('button')
    expect(notification.text()).toContain('Battery update')
    await notification.trigger('click')
    expect(historyNotifications.value[0].read).toBe(true)
    wrapper.unmount()
    historyNotifications.value = []
  })
})
