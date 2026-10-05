import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { state } from '../composables/useInverterState'
import DailyStats from './DailyStats.vue'

describe('DailyStats', () => {
  beforeEach(() => {
    state.value = {
      ...state.value,
      daily_stats: {},
      solar_forecast: undefined,
    }
  })

  it('does not throw when hasSolar evaluates prodY (yesterday production)', async () => {
    state.value = {
      ...state.value,
      daily_stats: {
        produced_today: 0,
        produced_yesterday: 12.3,
      },
      solar_forecast: {},
    }

    const w = mount(DailyStats)
    expect(w.text()).toContain('0.00kWh')
    expect(w.text()).toContain('(12.3)')
  })

  it('shows solar strip from forecast alone when today/yesterday are zero', async () => {
    state.value = {
      ...state.value,
      daily_stats: {
        produced_today: 0,
        produced_yesterday: 0,
      },
      solar_forecast: { today_kwh: 18.5, tomorrow_kwh: 20 },
    }

    const w = mount(DailyStats)
    expect(w.text()).toContain('[18.5]')
    expect(w.text()).toContain('[20.0]')
  })
})

it('does not turn unknown grid energy into a zero-cost estimate', () => {
  state.value = {
    ...state.value,
    daily_stats: { grid_kwh: null },
    ui_config: {
      ...state.value.ui_config,
      electricity_tariff: {
        version: 2,
        name: 'Flat tariff',
        currency: 'USD',
        timeZone: 'UTC',
        source: 'manual',
        seasons: [],
        rates: Array.from({ length: 48 }, () => Array(7).fill(0.2)),
      },
    },
  }
  const wrapper = mount(DailyStats)
  expect(wrapper.text()).not.toContain('≈')
  expect(wrapper.text()).toContain('0.2000 USD/kWh')
  wrapper.unmount()
})


it('keeps tariff controls and billing paragraphs out of the energy strip', () => {
  const wrapper = mount(DailyStats)
  for (const text of ['Controller tariff', 'Use a local tariff', 'Interval energy cost', 'Billing period']) {
    expect(wrapper.text()).not.toContain(text)
  }
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
