<template>
  <div class="flex flex-col gap-1 h-full">
    <!-- EV Section -->
    <div
      v-if="
        showEv !== false &&
        (features?.ev === true ||
          evPresent ||
          evPowerWatts !== undefined ||
          evChargingKw !== undefined ||
          evLoadPower > 0 ||
          carSoc !== undefined)
      "
      class="classic-card"
      data-testid="ev-section"
    >
      <div class="classic-header flex items-center gap-1.5">
        <Car :size="10" /> {{ $t('sections.ev') }}
      </div>
      <div class="p-1 flex justify-between items-center gap-2">
        <div>
          <div class="text-xl font-bold text-solar leading-none">
            {{ formatMeasurement(evChargingKw, 1, 'kW') }}
          </div>
          <div class="text-[10px] text-slate-500 font-bold text-center">
            {{ $t('sections.charging') }}
          </div>
        </div>
        <div class="text-center">
          <div class="text-xl font-bold text-slate-500 leading-none">{{ evPower }}</div>
          <div class="text-[10px] text-slate-500 font-bold tracking-tighter">
            {{ $t('sections.charger') }}
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-bold text-accent leading-none">
            {{ formatMeasurement(carSoc, 0, '%') }}
          </div>
          <div class="text-[10px] text-slate-500 font-bold text-center tracking-tighter">
            {{ $t('sections.soc') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Water Section -->
    <div v-if="hasWater" class="classic-card" data-testid="water-section">
      <div class="classic-header flex items-center gap-1.5">
        <Droplets :size="10" /> {{ $t('sections.water') }}
      </div>
      <div class="p-1 flex justify-between items-center gap-2 px-2">
        <div class="text-xl font-bold" :class="waterValve === true ? 'text-red-500' : 'text-green-500'">
          {{ formatMeasurement(waterLevel, 1, '%') }}
        </div>
        <div class="flex gap-1">
          <template v-if="readOnly">
            <span class="classic-status" :class="{ 'classic-status-on': pumpSwitch === true }"
              >{{ $t('sections.pump') }}{{ typeof pumpSwitch === 'boolean' ? '' : ' —' }}</span
            >
            <span class="classic-status" :class="{ 'classic-status-on': waterValve === true }"
              >{{ $t('sections.valve') }}{{ typeof waterValve === 'boolean' ? '' : ' —' }}</span
            >
          </template>
          <template v-else>
            <button
              type="button"
              class="classic-btn"
              :class="{ 'classic-btn-on': pumpSwitch }"
              aria-label="Pump manual mode"
              :aria-pressed="pumpSwitch"
              :disabled="!canControlPump || typeof pumpSwitch !== 'boolean'"
              @click="sendWaterMode('pump', pumpSwitch ? 2 : 1)"
            >
              {{ $t('sections.pump') }}{{ typeof pumpSwitch === 'boolean' ? '' : ' —' }}
            </button>
            <button
              type="button"
              class="classic-btn"
              :class="{ 'classic-btn-on': waterValve }"
              aria-label="Valve manual mode"
              :aria-pressed="waterValve"
              :disabled="!canControlValve || typeof waterValve !== 'boolean'"
              @click="onValveClick"
            >
              {{ $t('sections.valve') }}{{ typeof waterValve === 'boolean' ? '' : ' —' }}
            </button>
            <button v-if="pumpMode === 1 || pumpMode === 2" type="button" class="classic-btn"
              aria-label="Pump automatic mode" :disabled="!canControlPump"
              @click="sendWaterMode('pump', 0)">Auto</button>
            <button v-if="waterValveMode === 1 || waterValveMode === 2" type="button" class="classic-btn"
              aria-label="Valve automatic mode" :disabled="!canControlValve"
              @click="sendWaterMode('valve', 0)">Auto</button>
          </template>
        </div>
      </div>
    </div>

    <!-- Home Controls -->
    <div
      v-if="!readOnly && features?.ha !== false && showHomeSection !== false && homeButtons.length > 0"
      class="classic-card flex-1 min-h-0"
    >
      <div class="classic-header flex items-center gap-1.5">
        <HomeIcon :size="10" /> {{ $t('sections.home') }}
      </div>
      <div class="p-1 flex flex-wrap gap-0.5 overflow-y-auto max-h-[300px]">
        <button
          type="button"
          v-for="btn in homeButtons"
          :key="btn.id"
          class="classic-btn !flex-1 !min-w-[50px] !normal-case flex flex-col items-center gap-0.5"
          :class="{ 'classic-btn-on': buttonStates[btn.id] === 'on' }"
          :disabled="!canControlHa || buttonStates[btn.id] !== 'on' && buttonStates[btn.id] !== 'off'"
          :aria-pressed="buttonStates[btn.id] === 'on' ? true : buttonStates[btn.id] === 'off' ? false : undefined"
          @click="$emit('send', 'toggle', { entity: btn.entity })"
        >
          <component
            :is="getHomeButtonIcon(btn.entity, btn.label)"
            v-if="getHomeButtonIcon(btn.entity, btn.label)"
            :size="14"
            class="opacity-70"
          />
          <span class="text-[9px] leading-tight">{{ btn.label }}</span>
        </button>
      </div>
    </div>

    <!-- HA Weather -->
    <div v-if="haWeather && appConfig?.show_ha_weather !== false" class="classic-card">
      <div class="classic-header flex items-center gap-1.5">
        <CloudSun :size="10" /> {{ haWeather.name }}
      </div>
      <div class="p-1">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <span class="text-lg font-bold text-slate-700 dark:text-slate-300">
              {{ haWeather.temperature }}{{ haWeather.unit }}
            </span>
            <span class="text-[10px] text-slate-500 capitalize">{{ haWeather.state }}</span>
          </div>
        </div>
        <!-- Forecast -->
        <div v-if="haWeather.forecast.length > 0" class="mt-1 flex gap-1 overflow-x-auto">
          <div
            v-for="(day, idx) in haWeather.forecast.slice(0, 5)"
            :key="idx"
            class="flex flex-col items-center min-w-[40px] px-1 py-0.5 rounded bg-slate-50 dark:bg-slate-800/50"
          >
            <span class="text-[8px] text-slate-400">{{
              (day.datetime as string)?.slice(5, 10) || ''
            }}</span>
            <span class="text-[10px] font-bold">{{ day.temperature }}{{ haWeather.unit }}</span>
            <span class="text-[8px] text-slate-500 capitalize truncate max-w-[36px]">{{
              day.condition as string
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- HA Sensors (collapsed by default) -->
    <div v-if="haSensors.length > 0 && appConfig?.show_ha_sensors !== false" class="classic-card">
      <button
        type="button"
        :aria-expanded="sensorsExpanded"
        class="w-full text-left classic-header flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        @click="sensorsExpanded = !sensorsExpanded"
      >
        <Gauge :size="10" /> {{ $t('sections.sensors') }} ({{ haSensors.length }})
        <span class="ml-auto text-[10px]">{{ sensorsExpanded ? '▼' : '▶' }}</span>
      </button>
      <div v-if="sensorsExpanded" class="p-1 flex flex-col gap-0.5">
        <div
          v-for="sensor in haSensors"
          :key="sensor.entity_id"
          class="flex justify-between items-center px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
        >
          <span class="text-[10px] font-medium text-slate-500 truncate mr-2">
            {{ sensor.name }}
          </span>
          <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {{ sensor.state }}{{ sensor.unit }}
          </span>
        </div>
      </div>
    </div>

    <!-- HA Numbers (collapsed by default) -->
    <div v-if="!readOnly && haNumbers.length > 0 && appConfig?.show_ha_numbers !== false" class="classic-card">
      <button
        type="button"
        :aria-expanded="numbersExpanded"
        class="w-full text-left classic-header flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        @click="numbersExpanded = !numbersExpanded"
      >
        <Sliders :size="10" /> {{ $t('sections.numbers') }} ({{ haNumbers.length }})
        <span class="ml-auto text-[10px]">{{ numbersExpanded ? '▼' : '▶' }}</span>
      </button>
      <div v-if="numbersExpanded" class="p-1 flex flex-col gap-1">
        <div v-for="num in haNumbers" :key="num.entity_id" class="flex flex-col gap-0.5">
          <div class="flex justify-between items-center px-1">
            <span
              :id="'num-label-' + num.entity_id"
              class="text-[10px] font-medium text-slate-500 truncate mr-2"
            >
              {{ num.name }}
            </span>
            <span class="text-[10px] font-bold text-slate-600 dark:text-slate-400">
              {{ num.value }}{{ num.unit }}
            </span>
          </div>
          <input
            type="range"
            :disabled="!canControlHa"
            :id="'num-slider-' + num.entity_id"
            :aria-labelledby="'num-label-' + num.entity_id"
            :min="num.min"
            :max="num.max"
            :step="num.step"
            :value="num.value"
            class="w-full h-1 accent-blue-500 cursor-pointer"
            @change="
              $emit('number-set', num.entity_id, Number(($event.target as HTMLInputElement).value))
            "
          />
        </div>
      </div>
    </div>

    <!-- HA Covers (collapsed by default) -->
    <div v-if="!readOnly && haCovers.length > 0 && appConfig?.show_ha_covers !== false" class="classic-card">
      <button
        type="button"
        :aria-expanded="coversExpanded"
        class="w-full text-left classic-header flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        @click="coversExpanded = !coversExpanded"
      >
        <Blinds :size="10" /> {{ $t('sections.covers') }} ({{ haCovers.length }})
        <span class="ml-auto text-[10px]">{{ coversExpanded ? '▼' : '▶' }}</span>
      </button>
      <div v-if="coversExpanded" class="p-1 flex flex-col gap-1">
        <div v-for="cover in haCovers" :key="cover.entity_id" class="flex flex-col gap-0.5">
          <div class="flex justify-between items-center px-1">
            <span
              :id="'cover-label-' + cover.entity_id"
              class="text-[10px] font-medium text-slate-500 truncate mr-2"
            >
              {{ cover.name }}
            </span>
            <span class="text-[10px] font-bold text-slate-600 dark:text-slate-400">
              {{ cover.position }}%
            </span>
          </div>
          <input
            type="range"
            :disabled="!canControlHa"
            :id="'cover-slider-' + cover.entity_id"
            :aria-labelledby="'cover-label-' + cover.entity_id"
            min="0"
            max="100"
            :value="cover.position"
            class="w-full h-1 accent-blue-500 cursor-pointer"
            @change="
              $emit(
                'cover-position',
                cover.entity_id,
                Number(($event.target as HTMLInputElement).value)
              )
            "
          />
        </div>
      </div>
    </div>

    <!-- HA Media Players (collapsed by default) -->
    <div
      v-if="!readOnly && haMediaPlayers.length > 0 && appConfig?.show_ha_media !== false"
      class="classic-card"
    >
      <button
        type="button"
        :aria-expanded="mediaExpanded"
        class="w-full text-left classic-header flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        @click="mediaExpanded = !mediaExpanded"
      >
        <Play :size="10" /> {{ $t('sections.media') }} ({{ haMediaPlayers.length }})
        <span class="ml-auto text-[10px]">{{ mediaExpanded ? '▼' : '▶' }}</span>
      </button>
      <div v-if="mediaExpanded" class="p-1 flex flex-col gap-0.5">
        <div
          v-for="mp in haMediaPlayers"
          :key="mp.entity_id"
          class="flex items-center justify-between px-1 py-0.5"
        >
          <div class="flex flex-col min-w-0 mr-2">
            <span class="text-[10px] font-medium text-slate-500 truncate">{{ mp.name }}</span>
            <span class="text-[9px] text-slate-400 truncate">{{ mp.state }}</span>
          </div>
          <div class="flex gap-0.5 shrink-0">
            <button
              type="button"
              class="classic-btn !px-1.5 !py-0.5 !text-[9px]"
              :disabled="!canControlHa"
              @click="$emit('media-control', mp.entity_id, 'play')"
            >
              ▶
            </button>
            <button
              type="button"
              class="classic-btn !px-1.5 !py-0.5 !text-[9px]"
              :disabled="!canControlHa"
              @click="$emit('media-control', mp.entity_id, 'pause')"
            >
              ⏸
            </button>
            <button
              type="button"
              class="classic-btn !px-1.5 !py-0.5 !text-[9px]"
              :disabled="!canControlHa"
              @click="$emit('media-control', mp.entity_id, 'stop')"
            >
              ⏹
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Appliances -->
    <div
      v-if="(showDishwasher !== false && dishwasherRunning === true) || (showWasher !== false && washerRunning === true) || (showDryer !== false && dryerRunning === true)"
      data-testid="appliances"
      class="flex flex-col gap-0.5"
    >
      <div
        v-if="showDishwasher !== false && dishwasherRunning === true"
        data-testid="dishwasher"
        class="classic-card px-2 py-0.5 flex justify-between items-center"
      >
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{{
          $t('sections.dishwasher')
        }}</span>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-bold uppercase tracking-tighter"
            :class="dishwasherRunning ? 'text-green-600' : 'text-slate-400'"
            >{{ dishwasherRunning === undefined ? '—' : dishwasherRunning ? $t('sections.running') : 'Idle' }}</span
          >
          <span
            v-if="dishwasherDuration"
            class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
            >{{ formatDuration(dishwasherDuration) }}</span
          >
        </div>
      </div>

      <div
        v-if="showWasher !== false && washerRunning === true"
        data-testid="washer"
        class="classic-card px-2 py-0.5 flex justify-between items-center"
      >
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{{
          $t('sections.washer')
        }}</span>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-bold uppercase tracking-tighter"
            :class="washerRunning ? 'text-green-600' : 'text-slate-400'"
            >{{ washerRunning === undefined ? '—' : washerRunning ? $t('sections.running') : 'Idle' }}</span
          >
          <span
            v-if="washerTime"
            class="text-[11px] font-bold text-slate-700 dark:text-slate-300"
            >{{ formatDuration(washerTime) }}</span
          >
          <div
            v-if="washerPower !== undefined"
            class="w-1.5 h-1.5 rounded-full"
            :class="washerPower ? 'bg-green-500' : 'bg-slate-200'"
          ></div>
        </div>
      </div>

      <div
        v-if="showDryer !== false && dryerRunning === true"
        data-testid="dryer"
        class="classic-card px-2 py-0.5 flex justify-between items-center"
      >
        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{{
          $t('sections.dryer')
        }}</span>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[10px] font-bold uppercase tracking-tighter"
            :class="dryerRunning ? 'text-green-600' : 'text-slate-400'"
            >{{ dryerRunning === undefined ? '—' : dryerRunning ? $t('sections.running') : 'Idle' }}</span
          >
          <span v-if="dryerTime" class="text-[11px] font-bold text-slate-700 dark:text-slate-300">{{
            formatDuration(dryerTime)
          }}</span>
          <div
            v-if="dryerPower !== undefined"
            class="w-1.5 h-1.5 rounded-full"
            :class="dryerPower ? 'bg-green-500' : 'bg-slate-200'"
          ></div>
        </div>
      </div>
    </div>

    <!-- HA Scenes (collapsed by default) -->
    <div v-if="!readOnly && haScenes.length > 0 && appConfig?.show_ha_scenes !== false" class="classic-card">
      <button
        type="button"
        :aria-expanded="scenesExpanded"
        class="w-full text-left classic-header flex items-center gap-1.5 cursor-pointer hover:opacity-80"
        @click="scenesExpanded = !scenesExpanded"
      >
        <Sparkles :size="10" /> {{ $t('sections.scenes') }} ({{ haScenes.length }})
        <span class="ml-auto text-[10px]">{{ scenesExpanded ? '▼' : '▶' }}</span>
      </button>
      <div v-if="scenesExpanded" class="p-1 flex flex-wrap gap-0.5">
        <button
          type="button"
          v-for="scene in haScenes"
          :key="scene.entity_id"
          class="classic-btn !flex-1 !min-w-[50px] !normal-case !text-[10px]"
          :disabled="!canControlHa"
          @click="$emit('scene-activate', scene.entity_id)"
        >
          {{ scene.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatMeasurement } from '../telemetry'
import {
  Blinds,
  Car,
  CloudSun,
  Droplets,
  Gauge,
  Home as HomeIcon,
  Lightbulb,
  type LucideIcon,
  Play,
  PlugZap,
  Sliders,
  Sparkles,
  WashingMachine,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  HaCoverDisplay,
  HaMediaPlayerDisplay,
  HaNumberDisplay,
  HaSceneDisplay,
  HaSensorDisplay,
  HaWeatherDisplay,
} from '../types/ha'
import { formatDuration } from '../utils'

const props = withDefaults(defineProps<{
  features?: Record<string, boolean>
  haControlsAvailable?: boolean
  commandPending?: boolean
  evCharging: string
  evPower: string
  evPowerWatts?: number
  evChargingKw?: number
  evPresent?: boolean
  evLoadPower: number
  carSoc?: number
  waterVisible?: boolean
  waterControlsAvailable?: boolean
  waterPumpControlsAvailable?: boolean
  waterValveControlsAvailable?: boolean
  pumpMode?: number
  waterValveMode?: number
  waterLevel?: number
  waterValve?: boolean
  pumpSwitch?: boolean
  pumpSwitchEntity?: string
  waterValveEntity?: string
  dishwasherRunning?: boolean
  dishwasherDuration?: number
  washerRunning?: boolean
  washerTime?: number
  washerPower?: boolean
  dryerRunning?: boolean
  dryerTime?: number
  dryerPower?: boolean
  homeButtons: Array<{ id: string; label: string; entity: string }>
  buttonStates: Record<string, string>
  haSensors: HaSensorDisplay[]
  haNumbers: HaNumberDisplay[]
  haCovers: HaCoverDisplay[]
  haMediaPlayers: HaMediaPlayerDisplay[]
  haScenes: HaSceneDisplay[]
  haWeather: HaWeatherDisplay | null
  showEv?: boolean
  showWasher?: boolean
  showDryer?: boolean
  showDishwasher?: boolean
  showHomeSection?: boolean
  appConfig?: {
    show_ha_sensors?: boolean
    show_ha_numbers?: boolean
    show_ha_covers?: boolean
    show_ha_media?: boolean
    show_ha_scenes?: boolean
    show_ha_weather?: boolean
  } | null
  /** Public / here.now: status display only — no command controls. */
  readOnly?: boolean
}>(), {
  showEv: true,
  showWasher: true,
  showDryer: true,
  showDishwasher: true,
  showHomeSection: true,
  waterVisible: undefined,
  pumpSwitch: undefined,
  waterValve: undefined,
  waterPumpControlsAvailable: undefined,
  waterValveControlsAvailable: undefined,
})

const emit = defineEmits<{
  send: [action: string, payload?: Record<string, unknown>]
  'cover-position': [entityId: string, position: number]
  'media-control': [entityId: string, action: string]
  'number-set': [entityId: string, value: number]
  'scene-activate': [entityId: string]
}>()

function onValveClick() {
  if (!canControlValve.value || typeof props.waterValve !== 'boolean') return
  if (props.waterValve === false && !window.confirm('Open city water valve?')) return
  sendWaterMode('valve', props.waterValve ? 2 : 1)
}

const hasWater = computed(() => props.waterVisible ?? (props.waterLevel !== undefined
  || typeof props.pumpSwitch === 'boolean' || typeof props.waterValve === 'boolean'))
const canControlHa = computed(() => !props.readOnly && !props.commandPending && props.haControlsAvailable === true)
const canControlPump = computed(() => !props.readOnly && !props.commandPending
  && (props.waterPumpControlsAvailable ?? props.waterControlsAvailable) === true)
const canControlValve = computed(() => !props.readOnly && !props.commandPending
  && (props.waterValveControlsAvailable ?? props.waterControlsAvailable) === true)

function sendWaterMode(which: 'pump' | 'valve', mode: 0 | 1 | 2) {
  if (!(which === 'pump' ? canControlPump.value : canControlValve.value)) return
  emit('send', 'water_mode', { which, mode })
}

const { t: $t } = useI18n()

// HA sections collapsed by default
const sensorsExpanded = ref(false)
const numbersExpanded = ref(false)
const coversExpanded = ref(false)
const mediaExpanded = ref(false)
const scenesExpanded = ref(false)

/** Resolve icon for a home button based on entity domain and label */
function getHomeButtonIcon(entity: string, label: string): LucideIcon | null {
  const domain = entity.split('.')[0]
  const lowerLabel = label.toLowerCase()

  if (domain === 'light') return Lightbulb
  if (
    lowerLabel.includes('laundry') ||
    lowerLabel.includes('washer') ||
    lowerLabel.includes('washing')
  ) {
    return WashingMachine
  }
  if (lowerLabel.includes('guard')) return PlugZap
  // plug/socket → no icon, just text
  return null
}

</script>
