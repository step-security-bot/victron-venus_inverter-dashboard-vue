<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-1">
    <!-- Batteries Section -->
    <div v-if="showBatteries !== false" class="classic-card">
      <div class="classic-header flex items-center gap-1.5">
        <BatteryMedium :size="10" /> Batteries
      </div>
      <div class="p-1 flex flex-wrap gap-x-3 gap-y-1.5">
        <div
          v-for="(bat, index) in batteries"
          :key="index"
          class="flex-1 min-w-[130px] border border-slate-200 dark:border-slate-700/50 p-1 rounded-sm"
        >
          <div
            class="text-[10px] font-extrabold text-slate-600 dark:text-white uppercase tracking-tighter"
          >
            {{ bat.name }}
          </div>
          <div class="flex justify-between items-baseline gap-1 mt-0.5">
            <span class="text-[12px] text-slate-600 dark:text-white leading-none"
              >{{ formatMeasurement(bat.voltage, 2, 'V') }}</span
            >
            <span
              v-if="bat.current !== undefined"
              class="text-[11px] font-bold text-slate-500 dark:text-slate-300 leading-none"
              >{{ bat.current.toFixed(1) }}A</span
            >
            <span
              v-if="bat.power !== undefined"
              class="text-[11px] font-bold text-slate-500 dark:text-slate-300 leading-none"
              >{{ Math.floor(bat.power) }}W</span
            >
          </div>
          <div
            class="flex justify-between items-center mt-1 pt-1 border-t border-slate-200 dark:border-slate-700/50"
          >
            <span
              class="text-[12px] font-bold leading-none shrink-0"
              :class="
                bat.soc === undefined ? 'text-slate-400' : bat.soc > 50 ? 'text-battery' : bat.soc > 20 ? 'text-orange-500' : 'text-red-500'
              "
            >
              {{ formatMeasurement(bat.soc, 1, '%') }}
            </span>
            <span
              class="text-[10px] text-slate-400 font-medium truncate uppercase ml-2 text-right flex-1"
            >
              {{ bat.state }}<span v-if="bat.timeToGo"> · {{ bat.timeToGo }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Solar Production Section -->
    <div v-if="showSolar !== false" class="classic-card">
      <div class="classic-header flex items-center gap-1.5">
        <SunMedium :size="10" /> Solar Production
      </div>
      <div class="p-1 flex flex-wrap gap-x-2 gap-y-1.5">
        <div
          v-for="(src, index) in solarSources"
          :key="index"
          class="flex-1 min-w-[90px] border border-slate-200 dark:border-slate-700/50 p-1 rounded-sm"
        >
          <div
            class="text-[10px] font-bold text-slate-600 dark:text-slate-200 uppercase tracking-tighter"
          >
            {{ src.name }}
          </div>
          <div class="flex flex-col">
            <div class="flex justify-between items-baseline">
              <span v-if="src.pvVoltage != null" class="text-[10px] font-bold text-solar opacity-80"
                >{{ src.pvVoltage.toFixed(2) }}V</span
              >
              <span
                v-if="src.current != null"
                class="text-[10px] font-medium text-slate-500 dark:text-slate-300"
                >{{ src.current.toFixed(1) }}A</span
              >
            </div>
            <div class="text-xl font-bold text-solar leading-none mt-0.5">
              {{ formatMeasurement(src.power, 0, 'W') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BatteryMedium, SunMedium } from '@lucide/vue'
import { formatMeasurement } from '../telemetry'

defineProps<{
  batteries: Array<{
    name: string
    voltage?: number
    current?: number
    power?: number
    soc?: number
    state: string
    timeToGo?: string
  }>
  solarSources: Array<{ name: string; pvVoltage?: number; current?: number; power?: number }>
  showBatteries?: boolean
  showSolar?: boolean
}>()
</script>
