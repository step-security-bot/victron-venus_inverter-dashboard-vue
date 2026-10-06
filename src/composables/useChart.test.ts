import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { addHistoryPoint, setChartUpdateCallback, useChart } from './useChart'

describe('useChart', () => {
  beforeEach(() => {
    // Reset global state between tests
    setChartUpdateCallback(() => {})
  })

  it('repaints for a theme change without waiting for a new power sample', async () => {
    const scope = effectScope()
    const dark = ref(false)
    const chart = scope.run(() => useChart(dark))!
    const light = (chart.chartOption.value as { tooltip: { backgroundColor: string } }).tooltip.backgroundColor
    dark.value = true
    await nextTick()
    expect((chart.chartOption.value as { tooltip: { backgroundColor: string } }).tooltip.backgroundColor).not.toBe(light)
    scope.stop()
  })

  it('shows setpoint in the tooltip together with measured zero and negative power', () => {
    const chart = useChart(ref(false))
    const tooltip = (chart.chartOption.value as { tooltip: { formatter: (p: unknown[]) => string } }).tooltip
    const text = tooltip.formatter([
      { value: [Date.now(), -1500], seriesName: 'Setpoint', color: '#00bcd4' },
      { value: [Date.now(), 0], seriesName: 'Battery', color: '#4caf50' },
    ])
    expect(text).toContain('Setpoint: -1.5kW')
    expect(text).toContain('Battery: 0W')
  })

  describe('addHistoryPoint', () => {
    it('keeps missing readings as gaps rather than false zero power', () => {
      const chart = useChart(ref(false))
      addHistoryPoint({ gt: 0, battery_power: 0 })
      addHistoryPoint({ gt: 10 })
      chart.forceUpdateChart()
      const options = chart.chartOption.value as {
        series: Array<{ data: Array<[number, number | null]> }>
      }
      expect(options.series[0].data.slice(-2)[0]?.[1]).toBe(0)
      expect(options.series[2].data.slice(-2)[0]?.[1]).toBe(0)
      expect(options.series[2].data.slice(-1)[0]?.[1]).toBeNull()
      addHistoryPoint({})
      addHistoryPoint({ gt: 20 })
      chart.forceUpdateChart()
      const restored = chart.chartOption.value as typeof options
      expect(restored.series[0].data.slice(-2)[0]?.[1]).toBeNull()
      expect(restored.series[0].data.slice(-1)[0]?.[1]).toBe(20)
    })
    it('should add grid power to history', () => {
      addHistoryPoint({ gt: 1500, solar_total: 3000, battery_power: 0, setpoint: 0 })
      // Basic smoke test - verify no errors thrown
      expect(true).toBe(true)
    })

    it('should handle missing values gracefully', () => {
      expect(() => addHistoryPoint({})).not.toThrow()
    })

    it('should handle undefined values', () => {
      expect(() => addHistoryPoint({ gt: undefined, solar_total: undefined })).not.toThrow()
    })

    it('should handle zero values', () => {
      expect(() => addHistoryPoint({ gt: 0, solar_total: 0, battery_power: 0 })).not.toThrow()
    })

    it('should handle negative values (export mode)', () => {
      expect(() =>
        addHistoryPoint({ gt: -500, solar_total: 0, battery_power: -1000 })
      ).not.toThrow()
    })

    it('should handle large values', () => {
      expect(() =>
        addHistoryPoint({ gt: 50000, solar_total: 100000, battery_power: 20000 })
      ).not.toThrow()
    })
  })
})
