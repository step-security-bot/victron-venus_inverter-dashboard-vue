<template>
  <div class="grid grid-cols-2 md:grid-cols-5 gap-1.5 mb-0.5">
    <!-- Grid -->
    <div class="classic-card p-1.5 flex flex-col items-center justify-center min-h-[75px]">
      <div
        class="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200 font-bold mb-0.5"
      >
        Grid
        <span v-if="gridBackup?.service" data-testid="grid-backup" class="normal-case tracking-normal font-normal"
          :class="backupActive ? 'text-accent' : 'opacity-70'" :title="backupHint">· {{ backupPower }}</span>
      </div>
      <div class="text-3xl font-bold text-grid leading-none tracking-tight">
        {{ formatPower(gridL1Available === false && gridL2Available === false && gridL3Available !== true ? undefined : gt) }}
      </div>
      <div class="text-[11px] text-slate-500 dark:text-slate-300 font-bold">
        {{ formatPower(gridL1Available === false ? undefined : g1) }} <span class="opacity-30 mx-0.5">|</span> {{ formatPower(gridL2Available === false ? undefined : g2) }}
        <template v-if="g3 !== undefined"> <span class="opacity-30 mx-0.5">|</span> {{ formatPower(gridL3Available === false ? undefined : g3) }}</template>
      </div>
    </div>

    <!-- Consumption -->
    <div class="classic-card p-1.5 flex flex-col items-center justify-center min-h-[75px]">
      <div
        class="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200 font-bold mb-0.5"
      >
        Consumption
      </div>
      <div class="text-3xl font-bold text-consumption leading-none tracking-tight">
        {{ formatPower(tt) }}
      </div>
      <div class="text-[11px] text-slate-500 dark:text-slate-300 font-bold">
        {{ formatPower(t1) }} <span class="opacity-30 mx-0.5">|</span> {{ formatPower(t2) }}
        <template v-if="t3 !== undefined"> <span class="opacity-30 mx-0.5">|</span> {{ formatPower(t3) }}</template>
      </div>
    </div>

    <!-- Solar -->
    <div class="classic-card p-1.5 flex flex-col items-center justify-center min-h-[75px]">
      <div
        class="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200 font-bold mb-0.5"
      >
        Solar
      </div>
      <div class="text-3xl font-bold text-solar leading-none tracking-tight">
        {{ formatPower(solarTotal) }}
      </div>
      <div class="text-[11px] text-slate-500 dark:text-slate-300 font-bold">
        {{ formatPower(mpptTotal) }} <span class="opacity-30 mx-0.5">|</span>
        {{ formatPower(pvInvertersTotal) }}
      </div>
    </div>

    <!-- Battery -->
    <div class="classic-card p-1.5 flex flex-col items-center justify-center min-h-[75px]">
      <div
        class="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200 font-bold mb-0.5"
      >
        Battery
      </div>
      <div class="text-3xl font-bold text-battery leading-none tracking-tight">
        {{ formatMeasurement(batterySoc, 0, '%') }}
      </div>
      <div
        class="text-[11px] text-slate-500 dark:text-slate-300 font-bold truncate w-full text-center"
      >
        {{ formatPower(batteryPower) }} <span class="opacity-30 mx-0.5">|</span>
        {{ formatMeasurement(batteryVoltage, 2, 'V') }} <span class="opacity-30 mx-0.5">|</span>
        {{ formatMeasurement(batteryCurrent, 1, 'A') }}
      </div>
    </div>

    <!-- Setpoint -->
    <div class="classic-card p-1.5 flex flex-col items-center justify-center min-h-[75px]">
      <div
        class="text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200 font-bold mb-0.5"
      >
        Setpoint
        <SetpointOverride v-if="!readOnly" :status="overrideStatus" :source="overrideSource" :observedAt="overrideObservedAt"
          :currentSetpoint="setpoint" :connected="overrideConnected === true" :available="overrideAvailable === true"
          :commandError="commandError" @send="(action, payload) => emit('send', action, payload)" />
      </div>
      <div class="text-3xl font-bold text-accent leading-none tracking-tight">
        {{ formatPower(setpoint) }}
      </div>
      <div
        class="text-[11px] text-slate-500 dark:text-slate-300 font-bold truncate w-full text-center uppercase tracking-tighter"
      >
        {{ inverterState || '—' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GridBackupStatus } from '../composables/useInverterState'
import type { SetpointOverrideStatus } from '../setpointOverride'
import type { EssModeCommandError } from '../essMode'
import SetpointOverride from './SetpointOverride.vue'
import { formatPower } from '../utils'
import { formatMeasurement } from '../telemetry'

const props = withDefaults(defineProps<{
  readOnly?: boolean
  overrideSource?: string
  overrideStatus?: SetpointOverrideStatus | null
  overrideObservedAt?: number | null
  overrideConnected?: boolean
  overrideAvailable?: boolean
  commandError?: EssModeCommandError | null
  gridL1Available?: boolean
  gridL2Available?: boolean
  gridL3Available?: boolean
  gridBackup?: GridBackupStatus | null
  gridUsingBackup?: boolean
  gridBackupObservedAt?: number | null
  gt?: number
  g1?: number
  g2?: number
  g3?: number
  tt?: number
  t1?: number
  t2?: number
  t3?: number
  solarTotal?: number
  mpptTotal?: number
  pvInvertersTotal?: number
  batterySoc?: number
  batteryPower?: number
  batteryVoltage?: number
  batteryCurrent?: number
  setpoint?: number
  inverterState?: string
}>(), { gridL1Available: undefined, gridL2Available: undefined, gridL3Available: undefined })
const emit = defineEmits<{ send: [action: string, payload: Record<string, unknown>] }>()
const clock = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { clock.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(timer))
const backupLive = ref(false)
watch([clock, () => props.gridBackupObservedAt], () => {
  const observed = props.gridBackupObservedAt
  const age = typeof observed === 'number' ? Date.now() / 1000 - observed : Number.NaN
  backupLive.value = age >= -5 && age <= 30
}, { immediate: true, flush: 'sync' })
const backupActive = computed(() => props.gridUsingBackup && backupLive.value && props.gridBackup?.available === true)
const backupPower = computed(() => backupLive.value && props.gridBackup?.available === true
  ? formatPower(props.gridBackup.power ?? undefined) : '—')
const backupHint = computed(() => {
  if (!backupLive.value) return 'Grid submeter status is stale'
  if (backupActive.value) return 'Submeter is supplying the grid measurement'
  if (props.gridBackup?.available !== true) return 'Grid submeter unavailable'
  return props.gridBackup.enabled ? 'Grid submeter ready as backup' : 'Grid submeter detected; backup control disabled'
})
</script>
