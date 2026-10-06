<template>
  <div
    class="p-0 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium leading-tight text-slate-700 dark:text-slate-300"
  >
    <div v-if="hasSolar" class="flex items-center gap-1.5 mr-1">
      <span class="text-solar font-bold flex items-center gap-1">☀️ {{ prod }}kWh</span>
      <span
        v-if="fcToday"
        class="text-slate-500 dark:text-slate-400 text-[10px] font-bold tracking-tighter"
        >[{{ fcToday }}]</span
      >
      <span class="text-slate-500 dark:text-slate-400 text-[10px] font-bold tracking-tighter"
        >({{ prodY }})</span
      >
      <span
        v-if="fcTomorrow"
        class="text-slate-500 dark:text-slate-400 text-[10px] font-bold tracking-tighter"
        >[{{ fcTomorrow }}]</span
      >
      <span class="text-slate-600 dark:text-slate-400 font-medium text-[11px] tracking-tighter">{{
        solarStr
      }}</span>
      <span v-if="hasDollars" class="text-green-600 font-bold">(${{ dollars }})</span>
    </div>

    <div v-if="hasGrid" class="flex items-center gap-1.5 mr-1">
      <div v-if="hasSolar" class="w-px h-3 bg-slate-300"></div>
      <Zap :size="14" class="text-slate-400 dark:text-slate-500" />
      <span class="font-bold text-slate-600 dark:text-white">{{ grid }}kWh</span>
    </div>

    <DailyGridEnergy :energy="ds.grid_energy" />

    <TariffCost :kwh="ds.grid_kwh" :tariff-scope="tariffScope" :readOnly="readOnly" :configured-tariff="state.ui_config?.electricity_tariff" />

    <div v-if="hasBattery" class="flex items-center gap-1.5 flex-1 min-w-fit">
      <div v-if="hasSolar || hasGrid" class="w-px h-3 bg-slate-300"></div>
      <BatteryIcon :size="14" class="text-green-500" />
      <div class="flex items-center gap-1.5">
        <span
          class="text-slate-400 dark:text-slate-500 uppercase text-[10px] font-bold tracking-tighter"
          >I:</span
        >
        <span class="font-bold text-slate-600 dark:text-white">{{ batIn }}kWh</span>
        <span class="text-slate-400 dark:text-slate-500 text-[10px] font-bold">({{ batInY }})</span>

        <span
          class="text-slate-400 dark:text-slate-500 uppercase text-[10px] font-bold tracking-tighter ml-0.5"
          >O:</span
        >
        <span class="font-bold text-slate-600 dark:text-white">{{ batOut }}kWh</span>
        <span class="text-slate-400 dark:text-slate-500 text-[10px] font-bold"
          >({{ batOutY }})</span
        >

        <span
          class="text-slate-400 dark:text-slate-500 uppercase text-[10px] font-bold tracking-tighter ml-0.5"
          >Δ:</span
        >
        <span
          class="font-bold"
          :class="parseFloat(batDelta) >= 0 ? 'text-green-600' : 'text-red-600'"
          >{{ batDelta }}kWh</span
        >
        <span class="text-slate-400 dark:text-slate-500 text-[10px] font-bold"
          >({{ batDeltaY }})</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Battery as BatteryIcon, Zap } from '@lucide/vue'
import { computed } from 'vue'
import { state } from '../composables/useInverterState'

import DailyGridEnergy from './DailyGridEnergy.vue'
import TariffCost from '../tariffs/TariffCost.vue'

withDefaults(defineProps<{ tariffScope?: string; readOnly?: boolean }>(), { tariffScope: 'dashboard', readOnly: false })

const ds = computed(() => state.value.daily_stats || {})

// solar_forecast is a top-level state key from inverter-control, not inside daily_stats
const fc = computed(() => state.value.solar_forecast || {})
const fcToday = computed(() => (fc.value.today_kwh != null ? fc.value.today_kwh.toFixed(1) : ''))
const fcTomorrow = computed(() =>
  fc.value.tomorrow_kwh != null ? fc.value.tomorrow_kwh.toFixed(1) : ''
)

const prod = computed(() => (ds.value.produced_today || 0).toFixed(2))
const prodY = computed(() => (ds.value.produced_yesterday || 0).toFixed(1))
const dollars = computed(() => (ds.value.produced_dollars || 0).toFixed(2))
const grid = computed(() => (ds.value.grid_kwh || 0).toFixed(2))
const batIn = computed(() => (ds.value.battery_in || 0).toFixed(2))
const batOut = computed(() => (ds.value.battery_out || 0).toFixed(2))
const batInY = computed(() => (ds.value.battery_in_yesterday || 0).toFixed(1))
const batOutY = computed(() => (ds.value.battery_out_yesterday || 0).toFixed(1))
const batDelta = computed(() =>
  (Number.parseFloat(batIn.value) - Number.parseFloat(batOut.value)).toFixed(2)
)
const batDeltaY = computed(() =>
  (Number.parseFloat(batInY.value) - Number.parseFloat(batOutY.value)).toFixed(1)
)

const pvDaily = computed(() => ds.value.pv_inverter_daily || [])
const mpptDaily = computed(() => ds.value.mppt_daily || [])
const mpptTotalDaily = computed(() => mpptDaily.value.reduce((sum, value) => sum + value, 0))

const solarStr = computed(() => {
  const parts: string[] = []
  pvDaily.value.forEach((v) => {
    if (v > 0) parts.push(v.toFixed(2))
  })
  const mpptPart =
    mpptDaily.value.length > 0 ? mpptDaily.value.map((v) => v.toFixed(2)).join('+') : '0.00'
  parts.push(mpptTotalDaily.value.toFixed(2) + '(' + mpptPart + ')')
  return parts.join('+')
})

// Show the solar strip when today, yesterday, or forecast has data (early
// morning today=0 must not hide yesterday/forecast like a blank dashboard).
const hasSolar = computed(
  () =>
    Number.parseFloat(prod.value) > 0 ||
    Number.parseFloat(prodY.value) > 0 ||
    !!fcToday.value ||
    !!fcTomorrow.value
)
const hasGrid = computed(() => Number.parseFloat(grid.value) > 0)
const hasBattery = computed(
  () => Number.parseFloat(batIn.value) > 0 || Number.parseFloat(batOut.value) > 0
)
const hasDollars = computed(() => Number.parseFloat(dollars.value) > 0)
</script>
