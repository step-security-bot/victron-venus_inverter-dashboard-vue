<template>
  <ModalDialog :open="open" :label="t('config.title')" class="z-40 bg-black/60" @close="$emit('close')">
    <div class="absolute right-0 top-0 h-full w-72 bg-slate-900 p-3 overflow-y-auto shadow-xl">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-200">{{ t('config.title') }}</span>
        <button type="button" aria-label="Close settings" autofocus class="text-slate-400 hover:text-white" @click="$emit('close')">✕</button>
      </div>

      <label class="block mb-2">
        <span class="text-[10px] uppercase text-slate-400">Camera topic</span>
        <input
          v-model="cameraTopic"
          class="mt-0.5 w-full bg-slate-800 rounded px-2 py-1 text-xs text-slate-200"
          placeholder="(disabled)"
        />
      </label>

      <div class="mt-3 border-t border-slate-800 pt-2 space-y-1">
        <span class="text-[10px] uppercase text-slate-400">Connection</span>
        <label v-for="f in supportedConnections" :key="f.key" class="block">
          <span class="text-[10px] uppercase text-slate-400">{{ f.label }}</span>
          <input
            v-model="conn[f.key]"
            :type="'secret' in f && f.secret ? 'password' : 'text'"
            :placeholder="'placeholder' in f ? f.placeholder : ''"
            class="mt-0.5 w-full bg-slate-800 rounded px-2 py-1 text-xs text-slate-200"
          />
        </label>
      </div>

      <fieldset aria-label="Dashboard sections" class="m-0 min-w-0 border-0 p-0 space-y-1">
        <label
          v-for="opt in VISIBILITY"
          :key="opt.key"
          class="flex items-center justify-between text-xs text-slate-300 py-0.5"
        >
          {{ t(opt.label, opt.fallback) }}
          <input
            type="checkbox"
            :checked="visibility[opt.key] !== false"
            class="accent-blue-500"
            @change="toggle(opt.key, ($event.target as HTMLInputElement).checked)"
          />
        </label>
      </fieldset>

      <div class="mt-3 border-t border-slate-800 pt-2 text-slate-300">
        <TariffConfiguration v-if="open" tariff-scope="dashboard" :configured-tariff="state.ui_config?.electricity_tariff"
          :controller-writable="tariffWritable" :controller-revision="tariffRevision" :save-plan="saveControllerTariff" />
      </div>

      <SystemNotificationSettings v-if="open" />

      <p v-if="connectionError" role="alert" class="mt-3 text-xs text-red-300">{{ connectionError }}</p>

      <button
        class="mt-3 w-full rounded bg-blue-600 hover:bg-blue-500 py-1.5 text-xs font-bold text-white"
        @click="save"
      >
        {{ t('config.save') }}
      </button>
    </div>
  </ModalDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TariffPlan } from '../tariffs/model'
import TariffConfiguration from '../tariffs/TariffConfiguration.vue'
import ModalDialog from './ModalDialog.vue'
import SystemNotificationSettings from './SystemNotificationSettings.vue'
import { state } from '../composables/useInverterState'

const props = defineProps<{
  open: boolean
  tariffWritable?: boolean
  tariffRevision?: string
  saveControllerTariff?: (plan: TariffPlan | null, revision: string) => Promise<void>
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', patch: Record<string, unknown>): void
}>()

const VISIBILITY = [
  { key: 'show_ev', label: 'sections.ev', fallback: 'EV' },
  { key: 'show_washer', label: 'sections.washer', fallback: 'Washer' },
  { key: 'show_dryer', label: 'sections.dryer', fallback: 'Dryer' },
  { key: 'show_dishwasher', label: 'sections.dishwasher', fallback: 'Dishwasher' },
  { key: 'show_home_section', label: 'sections.home', fallback: 'Home' },
  { key: 'show_ha_covers', label: 'sections.covers', fallback: 'Covers' },
  { key: 'show_ha_media', label: 'sections.media', fallback: 'Media players' },
  { key: 'show_ha_scenes', label: 'sections.scenes', fallback: 'Scenes' },
  { key: 'show_ha_weather', label: 'sections.weather', fallback: 'Weather' },
  { key: 'show_daily_stats', label: 'sections.dailyStats', fallback: 'Daily energy' },
  { key: 'show_header_toggles', label: 'sections.headerToggles', fallback: 'Control buttons' },
  { key: 'show_batteries', label: 'sections.batteries', fallback: 'Batteries' },
  { key: 'show_solar_production', label: 'sections.solarProduction', fallback: 'Solar production' },
  { key: 'show_active_loads', label: 'sections.activeLoads', fallback: 'Active loads' },
  { key: 'show_ha_sensors', label: 'sections.sensors', fallback: 'Sensors' },
  { key: 'show_ha_numbers', label: 'sections.numbers', fallback: 'Numbers' },
] as const

const settings = computed(() => state.value.ui_config?.settings ?? {})
const visibility = computed<Record<string, boolean | undefined>>(() => {
  const out: Record<string, boolean | undefined> = {}
  for (const opt of VISIBILITY) out[opt.key] = settings.value[opt.key]
  return out
})

const { t } = useI18n()

// Only connection edits are patched; an unchanged server default may not be
// valid for a different transport. Masked credentials are never sent back.
const CONNECTION = [
  { key: 'mqtt_host', label: 'MQTT host' },
  { key: 'mqtt_port', label: 'MQTT port' },
  { key: 'mqtt_username', label: 'MQTT user' },
  { key: 'mqtt_password', label: 'MQTT pass', secret: true },
  { key: 'ha_url', label: 'HA URL', placeholder: 'https://homeassistant.local:8123' },
  { key: 'ha_token', label: 'HA token', secret: true },
] as const

const supportedConnections = computed(() => CONNECTION.filter((field) => Object.keys(settings.value).includes(field.key)))
const conn = ref<Record<string, string>>({})
let connectionBaseline: Record<string, string> = {}
const connectionError = ref('')

// Local edit buffers, seeded from the server state when the drawer opens.
const cameraTopic = ref('')
watch(
  () => props.open,
  (o) => {
    if (!o) return
    cameraTopic.value = settings.value.camera_topic ?? ''
    const next: Record<string, string> = {}
    for (const f of supportedConnections.value) {
      const v = settings.value[f.key]
      next[f.key] = v == null ? '' : String(v)
    }
    connectionBaseline = { ...next }
    conn.value = next
    connectionError.value = ''
  },
  { immediate: true }
)

function toggle(key: string, val: boolean) {
  emit('save', { [key]: val })
}

function save() {
  connectionError.value = ''
  const patch: Record<string, unknown> = { camera_topic: cameraTopic.value.trim() }
  for (const f of supportedConnections.value) {
    const raw = (conn.value[f.key] ?? '').trim()
    if (raw === (connectionBaseline[f.key] ?? '').trim()) continue
    if ('secret' in f && f.secret && raw === '***') continue
    if (f.key === 'mqtt_port') {
      const port = Number(raw)
      if (raw === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
        connectionError.value = 'MQTT port must be an integer from 1 to 65535.'
        return
      }
      patch[f.key] = port
    } else {
      patch[f.key] = raw
    }
  }
  emit('save', patch)
}
</script>
