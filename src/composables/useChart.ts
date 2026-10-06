import { type Ref, ref, watch, getCurrentScope, onScopeDispose } from 'vue'

const MAX_HISTORY_POINTS = 1800
const CHART_UPDATE_INTERVAL_MS = 1000

interface TooltipParam {
  value: [number, number | null]
  seriesName: string
  color: string
}

const historyData = {
  timestamps: [] as number[],
  grid: [] as (number | null)[],
  solar: [] as (number | null)[],
  battery: [] as (number | null)[],
  setpoint: [] as (number | null)[],
}

let chartUpdateCallback: (() => void) | null = null

export function setChartUpdateCallback(cb: () => void) {
  chartUpdateCallback = cb
}

export function historyLength(): number {
  return historyData.timestamps.length
}

export function addHistoryPoint(newState: {
  gt?: number
  solar_total?: number
  battery_power?: number
  setpoint?: number
}) {
  // Seed whenever any power series is present (public snapshot may omit setpoint).
  if (
    newState.gt === undefined &&
    newState.solar_total === undefined &&
    newState.battery_power === undefined
  ) {
    const last = historyData.timestamps.length - 1
    if (
      last < 0 ||
      (historyData.grid[last] === null &&
        historyData.solar[last] === null &&
        historyData.battery[last] === null)
    )
      return
  }
  const now = Date.now() / 1000
  historyData.timestamps.push(now)
  historyData.grid.push(newState.gt ?? null)
  historyData.solar.push(newState.solar_total ?? null)
  historyData.battery.push(newState.battery_power ?? null)
  historyData.setpoint.push(newState.setpoint ?? null)
  if (historyData.timestamps.length > MAX_HISTORY_POINTS) {
    historyData.timestamps.shift()
    historyData.grid.shift()
    historyData.solar.shift()
    historyData.battery.shift()
    historyData.setpoint.shift()
  }
  if (chartUpdateCallback) chartUpdateCallback()
}

export function useChart(isDarkRef: Ref<boolean>) {
  const chartOption = ref({})
  let lastChartUpdate = 0

  // Register callback so addHistoryPoint triggers chart updates
  const onHistory = () => updateChartOption(false)
  setChartUpdateCallback(onHistory)
  const stopTheme = watch(isDarkRef, () => updateChartOption(true))
  if (getCurrentScope()) onScopeDispose(() => {
    stopTheme()
    if (chartUpdateCallback === onHistory) chartUpdateCallback = null
  })
  // Always paint axes immediately so publicMode never shows a blank broken area
  // before the first snapshot arrives (and when history stays empty).

  function updateChartOption(force: boolean) {
    const now = Date.now()
    if (!force && now - lastChartUpdate < CHART_UPDATE_INTERVAL_MS) return
    lastChartUpdate = now

    const { timestamps, grid, solar, battery, setpoint } = historyData
    const dark = isDarkRef.value
    const textColor = dark ? '#e0e0e0' : '#333'
    const gridColor = dark ? '#444' : '#e0e0e0'
    const timeData = timestamps.map((ts) => ts * 1000)

    chartOption.value = {
      animation: false,
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: dark ? '#242424' : '#fff',
        borderColor: dark ? '#444' : '#ccc',
        axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
        textStyle: { color: textColor, fontSize: 10 },
        formatter: (params: TooltipParam[]) => {
          const date = new Date(params[0].value[0])
          const timeStr = date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
          let result = `${timeStr}<br/>`
          params.forEach((p: TooltipParam) => {
            if (p.value[1] === null) return
            const val = Math.floor(p.value[1])
            const valStr = Math.abs(val) >= 1000 ? `${(val / 1000).toFixed(1)}kW` : `${val}W`
            result += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${p.color};"></span>`
            result += `${p.seriesName}: ${valStr}<br/>`
          })
          return result
        },
      },
      legend: {
        data: ['Grid', 'Solar', 'Battery', 'Setpoint'],
        top: 0,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: textColor, fontSize: 10 },
      },
      grid: { top: 25, bottom: 25, left: 40, right: 10, containLabel: false },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: gridColor } },
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: '{HH}:{mm}',
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
        },
      },
      series: [
        {
          name: 'Grid',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: timeData.map((t, i) => [t, grid[i] ?? null]),
          lineStyle: { color: '#3b82f6', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,0.1)' },
        },
        {
          name: 'Solar',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: timeData.map((t, i) => [t, solar[i] ?? null]),
          lineStyle: { color: '#f59e0b', width: 2 },
          areaStyle: { color: 'rgba(245,158,11,0.1)' },
        },
        {
          name: 'Battery',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: timeData.map((t, i) => [t, battery[i] ?? null]),
          lineStyle: { color: '#22c55e', width: 2 },
          areaStyle: { color: 'rgba(34,197,94,0.1)' },
        },
        {
          name: 'Setpoint',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: timeData.map((t, i) => [t, setpoint[i] ?? null]),
          lineStyle: { color: '#06b6d4', width: 2, type: 'dashed' },
          areaStyle: { opacity: 0 },
        },
      ],
    }
  }

  function forceUpdateChart() {
    updateChartOption(true)
  }

  // Initial empty axes (legend + grid) — not `{}` which leaves a blank pane.
  updateChartOption(true)

  return { chartOption, forceUpdateChart }
}
