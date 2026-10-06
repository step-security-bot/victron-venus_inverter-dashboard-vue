<template>
  <ErrorBoundary>
    <div id="app" class="h-screen flex flex-col p-1 select-none overflow-hidden">
      <!-- Dashboard Header -->
      <div class="flex items-center justify-between mb-1">
        <AppHeader
          :dryRun="dryRun"
          :essClass="essClass"
          :essText="essText"
          :essMode="state.ess_mode"
          :essFresh="essFresh"
          :essControlsAvailable="state.ess_mode_controls_available"
          :commandError="commandError"
          :commandPending="commandBusy"
          :haControlsAvailable="haControlsAvailable"
          :headerToggles="headerToggles"
          :toggleStates="headerToggleStates"
          :isDark="isDark"
          :readOnly="readOnly"
          :controlsAvailable="controllerControlsAvailable"
          :showHeaderToggles="uiSettings.show_header_toggles"
          @send="send"
          @toggle-theme="toggleTheme"
          @open-settings="settingsOpen = true"
        />
      </div>

      <!-- Dashboard Content -->
      <div class="flex-1 overflow-y-auto pr-0.5 flex flex-col gap-1 scrollbar-hide">
        <NotificationBanner />
        <output v-if="commandMessage" class="text-xs px-2 py-1" :class="commandFailed ? 'text-red-600' : 'text-slate-600 dark:text-slate-300'" aria-live="polite">{{ commandMessage }}</output>

        <CameraPopup />

        <SettingsDrawer
          v-if="!readOnly"
          :open="settingsOpen"
          :tariffWritable="tariffWritable" :tariffRevision="tariffRevision" :saveControllerTariff="saveControllerTariff"
          @close="settingsOpen = false"
          @save="onSaveSettings"
        />
        <DailyStats v-if="uiSettings.show_daily_stats !== false" :readOnly="readOnly" />

        <StatCards
          :gt="state.gt"
          :g1="state.g1"
          :g2="state.g2"
          :g3="state.g3"
          :gridL1Available="state.grid_l1_available"
          :gridL2Available="state.grid_l2_available"
          :gridL3Available="state.grid_l3_available"
          :gridBackup="state.grid_backup"
          :gridUsingBackup="state.grid_using_backup"
          :gridBackupObservedAt="state.grid_backup_observed_at"
          :tt="state.tt"
          :t1="state.t1"
          :t2="state.t2"
          :t3="state.t3"
          :solarTotal="state.solar_total"
          :mpptTotal="mpptTotal"
          :pvInvertersTotal="pvInvertersTotal"
          :batterySoc="state.battery_soc"
          :batteryPower="state.battery_power"
          :batteryVoltage="state.battery_voltage"
          :batteryCurrent="state.battery_current"
          :setpoint="state.setpoint"
          :inverterState="state.inverter_state"
          :overrideStatus="state.setpoint_override"
          :overrideSource="state.data_source"
          :overrideObservedAt="state.setpoint_override_observed_at"
          :overrideAvailable="state.setpoint_override_controls_available === true"
          :overrideConnected="commandConnected && nativeConnected"
          :readOnly="readOnly"
          :commandError="commandError"
          @send="send"
        />

        <div class="grid grid-cols-1 md:grid-cols-12 gap-1">
          <div class="md:col-span-8 h-[280px]">
            <ChartPanel :chartOption="chartOption" />
          </div>
          <div class="md:col-span-4">
            <SidePanel
              :features="state.features"
              :appConfig="uiSettings"
              :haControlsAvailable="haControlsAvailable"
              :commandPending="commandBusy"
              :evCharging="evCharging"
              :evPower="evPower"
              :evPowerWatts="evPowerWatts"
              :evChargingKw="evChargingKw"
              :evLoadPower="evLoadPower"
              :carSoc="ev.soc"
              :evPresent="ev.present"
              :waterLevel="state.water_level"
              :waterVisible="waterVisible"
              :pumpMode="state.water_pump_mode ?? state.pump_mode"
              :waterValveMode="state.water_valve_mode"
              :waterPumpControlsAvailable="waterPumpControlsAvailable"
              :waterValveControlsAvailable="waterValveControlsAvailable"
              :waterValve="state.water_valve"
              :pumpSwitch="state.pump_switch"
              :dishwasherRunning="dishwasherRunning"
              :dishwasherDuration="state.dishwasher_duration"
              :washerRunning="washerRunning"
              :washerTime="state.washer_time"
              :washerPower="appliancePowerActive(state.washer_power)"
              :dryerRunning="dryerRunning"
              :dryerTime="state.dryer_time"
              :dryerPower="appliancePowerActive(state.dryer_power)"
              :homeButtons="homeButtons"
              :buttonStates="buttonStates"
              :haSensors="haSensors"
              :haNumbers="haNumbers"
              :haCovers="haCovers"
              :haMediaPlayers="haMediaPlayers"
              :haScenes="haScenes"
              :haWeather="haWeather"
              :showEv="uiSettings.show_ev !== false"
              :showWasher="uiSettings.show_washer !== false"
              :showDryer="uiSettings.show_dryer !== false"
              :showDishwasher="uiSettings.show_dishwasher !== false"
              :showHomeSection="uiSettings.show_home_section !== false"
              :readOnly="readOnly"
              @send="send"
              @number-set="onNumberSet"
              @cover-position="onCoverPosition"
              @media-control="onMediaControl"
              @scene-activate="onSceneActivate"
            />
          </div>
        </div>

        <BatterySolarPanel
          :batteries="batteries"
          :solarSources="solarSources"
          :showBatteries="uiSettings.show_batteries !== false"
          :showSolar="uiSettings.show_solar_production !== false"
        />

        <LoadsTable v-if="uiSettings.show_active_loads !== false" :loads="sortedLoads" />
      </div>

      <!-- Bottom Status Bar -->
      <StatusBar
        :haEnabled="haEnabled"
        :haConnected="haConnected"
        :mqttConnected="nativeConnected"
        :dataSource="state.data_source"
        :telemetry="state.telemetry"
        :haMqttConnected="null"
        :uptime="state.uptime"
        :appVersion="state.dashboard_version || ''"
        :stateVersion="state.version"
      />

    </div>
  </ErrorBoundary>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import AppHeader from './components/AppHeader.vue'
import BatterySolarPanel from './components/BatterySolarPanel.vue'
import CameraPopup from './components/CameraPopup.vue'
import ChartPanel from './components/ChartPanel.vue'
import DailyStats from './components/DailyStats.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import LoadsTable from './components/LoadsTable.vue'
import NotificationBanner from './components/NotificationBanner.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import SidePanel from './components/SidePanel.vue'
import StatCards from './components/StatCards.vue'
import StatusBar from './components/StatusBar.vue'
import { useChart } from './composables/useChart'
import { useControllerTariff } from './composables/useControllerTariff'
import { useCommandFeedback } from './composables/useCommandFeedback'
import { isSetpointOverrideFresh } from './setpointOverride'
import { useConnection } from './composables/useConnection'
import { setNotificationCommandSender } from './composables/useNotifications'
import { appliancePowerActive, useHA } from './composables/useHA'
import { initSystemNotifications } from './composables/useSystemNotifications'
import { useTheme } from './composables/useTheme'
import { isPublicMode } from './config/publicMode'
import { isEssModeCommandFresh } from './essMode'
import { essStatus, evTelemetry } from './controllerTelemetry'
import { activeLoads, waterControlAvailable, waterPresent } from './nativeSections'
import { connectionStatus } from './telemetry'
import { controlBooleanState, formatPower, inverterControlFlagKey, resolveHeaderToggleState } from './utils'

const readOnly = isPublicMode()

const {
  state,
  mqttConnected,
  commandConnected,
  commandError,
  commandResult,
  connectMqtt,
  send: wsSend,
  cleanup: cleanupConnection,
} = useConnection()

const { busy: commandBusy, message: commandMessage, failed: commandFailed, submit: submitCommand, refuse: refuseCommand } = useCommandFeedback(commandConnected, commandError, commandResult, wsSend)

if (!readOnly) setNotificationCommandSender(wsSend)

const {
  haEnabled,
  haConnected,
  homeButtons,
  buttonStates,
  headerToggles,
  headerToggleStates,
  haSensors,
  haNumbers,
  haCovers,
  haMediaPlayers,
  haScenes,
  haWeather,
  dishwasherRunning,
  washerRunning,
  dryerRunning,
  initHa,
  cleanupHa,
} = useHA()
const { isDark, toggleTheme } = useTheme()
const settingsOpen = ref(false)
const now = ref(Date.now())
const essFresh = computed(() => {
  // Keep idle observations aging, but do not use a throttled timer's old time
  // when a fresh observation arrives in a background tab.
  void now.value
  return isEssModeCommandFresh(state.value.ess_mode, state.value.ess_mode_observed_at)
})
let essClock: ReturnType<typeof setInterval> | undefined
onMounted(() => { essClock = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { clearInterval(essClock) })
const uiSettings = computed(() => state.value.ui_config?.settings ?? {})
const nativeConnected = computed(() => mqttConnected.value && connectionStatus(state.value) !== false)
const { writable: tariffWritable, revision: tariffRevision, save: saveControllerTariff } = useControllerTariff({
  state, connected: computed(() => commandConnected.value && nativeConnected.value), readOnly, commandError, send: wsSend,
})
const controllerControlsAvailable = computed(() =>
  commandConnected.value && nativeConnected.value && state.value.controller_controls_available !== false
)
const waterPumpControlsAvailable = computed(() =>
  commandConnected.value && nativeConnected.value && waterControlAvailable(state.value, 'pump'))
const waterValveControlsAvailable = computed(() =>
  commandConnected.value && nativeConnected.value && waterControlAvailable(state.value, 'valve'))
const haControlsAvailable = ref(false)
watch([now, commandConnected, state], () => {
  const at = state.value.ha_observed_at
  const age = typeof at === 'number' ? Date.now() / 1000 - at : Number.NaN
  haControlsAvailable.value = !readOnly && commandConnected.value && state.value.ha_direct_connected === true
    && state.value.ha_controls_available === true && age >= 0 && age <= 30
}, { immediate: true, flush: 'sync' })
const waterSeen = ref(false)
watchEffect(() => { if (waterPresent(state.value)) waterSeen.value = true })
const waterVisible = computed(() => waterSeen.value || waterPresent(state.value))
const dryRun = computed(() => {
  const value = controlBooleanState(state.value.dry_run)
  return value === 'unavailable' ? undefined : value === 'on'
})
function onSaveSettings(patch: Record<string, unknown>) {
  send('set_settings', patch)
}
const { chartOption, forceUpdateChart } = useChart(isDark)

function flagTogglePayload(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof payload.entity !== 'string') return payload
  const flag = inverterControlFlagKey(payload.entity)
  if (!flag) return payload
  if (!controllerControlsAvailable.value) return null
  const current = resolveHeaderToggleState({ id: flag, entity: flag }, state.value.booleans ?? {})
  if (current === 'unavailable') return null
  return { ...payload, entity: flag, state: payload.state ?? (current === 'on' ? 'off' : 'on') }
}

function selectionAllowed(action: string, payload: Record<string, unknown>): boolean {
  if (readOnly || !commandConnected.value || !nativeConnected.value) return false
  if (action === 'set_ess_mode') {
    return controllerControlsAvailable.value
      && isEssModeCommandFresh(state.value.ess_mode, state.value.ess_mode_observed_at)
      && state.value.ess_mode_controls_available === true
      && state.value.ess_mode?.selection_supported === true && dryRun.value === false
  }
  const valueValid = payload.value === null || (typeof payload.value === 'number'
    && Number.isInteger(payload.value) && payload.value >= -2147483648 && payload.value <= 2147483647)
  return valueValid && state.value.setpoint_override_controls_available === true
    && isSetpointOverrideFresh(state.value.setpoint_override, state.value.setpoint_override_observed_at)
}

function sendSelection(action: string, payload: Record<string, unknown>) {
  try {
    if (!selectionAllowed(action, payload) || !wsSend(action, payload)) refuseSelection(action, payload)
  } catch {
    // Vue events cannot propagate parent transport failures back to the control.
    refuseSelection(action, payload)
  }
}

function genericCommandAllowed(action: string, payload: Record<string, unknown>): boolean {
  const nativeBlocked = (action === 'ess_mode' || action === 'dry_run') && !controllerControlsAvailable.value
  const waterBlocked = action === 'water_mode' && !canSendWaterMode(payload)
  const haAction = ['number_set', 'set_cover_position', 'media_player', 'scene_activate'].includes(action)
    || (action === 'toggle' && typeof payload.entity === 'string' && inverterControlFlagKey(payload.entity) === null)
  return !(nativeBlocked || waterBlocked || (haAction && !haCommandFresh()))
}

function send(action: string, payload: Record<string, unknown> = {}) {
  if (action === 'set_setpoint_override' || action === 'set_ess_mode') {
    sendSelection(action, payload)
    return
  }
  if (readOnly || commandBusy.value) return
  if (action === 'toggle') {
    const normalized = flagTogglePayload(payload)
    if (normalized === null) { refuseCommand(); return }
    payload = normalized
  }
  if (!genericCommandAllowed(action, payload)) { refuseCommand(); return }
  submitCommand(action, payload)
}

function refuseSelection(action: string, payload: Record<string, unknown>) {
  if (typeof payload.request_id !== 'string') return
  commandError.value = {
    action, request_id: payload.request_id,
    error: 'Control is unavailable. No change was sent.',
  }
}

function haCommandFresh(): boolean {
  const at = state.value.ha_observed_at
  const age = typeof at === 'number' ? Date.now() / 1000 - at : Number.NaN
  return haControlsAvailable.value && age >= 0 && age <= 30
}

function canSendWaterMode(payload: Record<string, unknown>): boolean {
  if (payload.mode !== 0 && payload.mode !== 1 && payload.mode !== 2) return false
  if (payload.which === 'pump') return waterPumpControlsAvailable.value
  if (payload.which === 'valve') return waterValveControlsAvailable.value
  return false
}

async function onNumberSet(entityId: string, value: number) {
  send('number_set', { entity: entityId, value })
}

async function onCoverPosition(entityId: string, position: number) {
  send('set_cover_position', { entity: entityId, position })
}

async function onMediaControl(entityId: string, action: string) {
  send('media_player', { entity: entityId, mp_action: action })
}

async function onSceneActivate(entityId: string) {
  send('scene_activate', { entity: entityId })
}

const ess = computed(() => essStatus(state.value.ess_mode))
const essClass = computed(() => {
  if (!ess.value.available) return 'unavailable'
  return ess.value.active ? 'on' : 'off'
})
const essText = computed(() => ess.value.text)

const mpptTotal = computed(() => state.value.mppt_total)
const pvInvertersTotal = computed(() =>
  state.value.pv_inverter_total ?? (state.value.pv_inverters?.some((p) => p.power !== undefined)
    ? state.value.pv_inverters.reduce((sum, p) => sum + (p.power ?? 0), 0)
    : undefined)
)

const ev = computed(() => evTelemetry(state.value))
const evCharging = computed(() => ev.value.chargingKw === undefined ? '—' : `${ev.value.chargingKw.toFixed(1)}kW`)
const evPower = computed(() => formatPower(ev.value.power))
const evPowerWatts = computed(() => ev.value.power)
const evChargingKw = computed(() => ev.value.chargingKw)
const evLoadPower = computed(() => {
  const loads = state.value.loads
  if (!loads) return 0
  for (const [key, val] of Object.entries(loads)) {
    const name = (state.value.load_names?.[key] ?? key).toLowerCase()
    if (typeof val === 'number' && Number.isFinite(val) && (name.includes('ev') || name.includes('charger'))) return val
  }
  return 0
})

const sortedLoads = computed(() => activeLoads(state.value))

const batteries = computed(() => {
  const tiles: Array<{
    name: string
    voltage?: number
    current?: number
    power?: number
    soc?: number
    state: string
    timeToGo?: string
  }> = []
  for (const b of state.value.batteries || []) {
    tiles.push({
      name: b.name || `Battery ${b.instance ?? ''}`,
      voltage: b.voltage,
      current: b.current,
      power: b.power,
      soc: b.soc,
      state: b.state || 'Unknown',
      timeToGo: b.time_to_go || '',
    })
  }
  return tiles
})

const solarSources = computed(() => {
  const sources: Array<{ name: string; pvVoltage?: number; current?: number; power?: number }> = []
  ;(state.value.mppt_chargers || []).forEach((m) => {
    sources.push({
      name: m.name || 'MPPT',
      pvVoltage: m.pv_voltage,
      current: m.current,
      power: m.power,
    })
  })
  const pvInvs = state.value.pv_inverters
  if (pvInvs?.length) {
    pvInvs.forEach((p, i) => {
      sources.push({
        name: p.name || 'PV Inverter ' + (i + 1),
        pvVoltage: p.voltage ?? p.pv_voltage,
        current: p.current,
        power: p.power,
      })
    })
  }
  return sources
})

let cleanupSystemNotifications: (() => void) | undefined
onMounted(async () => {
  if (!readOnly) {
    setNotificationCommandSender(wsSend)
    cleanupSystemNotifications = initSystemNotifications()
  }
  forceUpdateChart()
  await connectMqtt()
  if (!readOnly) {
    initHa()
  }
})

onUnmounted(() => {
  cleanupSystemNotifications?.()
  setNotificationCommandSender(null)
  cleanupConnection()
  cleanupHa()
})
</script>
