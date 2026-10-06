import { computed, type Ref, ref, watch } from 'vue'
import type {
  HaCoverDisplay,
  HaMediaPlayerDisplay,
  HaNumberDisplay,
  HaSceneDisplay,
  HaSensorDisplay,
  HaWeatherDisplay,
} from '../types/ha'
import { isPublicMode } from '../config/publicMode'
import { controlBooleanState, DEFAULT_INVERTER_CONTROLS, resolveHeaderToggleState } from '../utils'
import { state } from './useInverterState'

// HA initialization and cleanup
function coerceBool(v: unknown): boolean {
  if (v === true || v === 1 || v === 'true' || v === '1' || v === 'on' || v === 'online')
    return true
  return false
}

// Rich HA entity displays pushed by the backend in state.ha_filtered
// ({sensors[], numbers[], covers[], media_players[], scenes[], weather}).
function populateFiltered(
  target: {
    sensors: Ref<HaSensorDisplay[]>
    numbers: Ref<HaNumberDisplay[]>
    covers: Ref<HaCoverDisplay[]>
    mediaPlayers: Ref<HaMediaPlayerDisplay[]>
    scenes: Ref<HaSceneDisplay[]>
    weather: Ref<HaWeatherDisplay | null>
  },
  filtered: Record<string, unknown> | null | undefined
) {
  const f = filtered ?? {}
  target.sensors.value = (f.sensors as HaSensorDisplay[]) ?? []
  target.numbers.value = (f.numbers as HaNumberDisplay[]) ?? []
  target.covers.value = (f.covers as HaCoverDisplay[]) ?? []
  target.mediaPlayers.value = (f.media_players as HaMediaPlayerDisplay[]) ?? []
  target.scenes.value = (f.scenes as HaSceneDisplay[]) ?? []
  target.weather.value = (f.weather as HaWeatherDisplay) ?? null
}

/** Current HA adapters send booleans; legacy snapshots may carry measured watts. */
export function appliancePowerActive(value: boolean | number | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value
  return typeof value === 'number' && Number.isFinite(value) ? value > 1 : undefined
}

export function useHA() {
  const haSensors = ref<HaSensorDisplay[]>([])
  const haNumbers = ref<HaNumberDisplay[]>([])
  const haCovers = ref<HaCoverDisplay[]>([])
  const haMediaPlayers = ref<HaMediaPlayerDisplay[]>([])
  const haScenes = ref<HaSceneDisplay[]>([])
  const haWeather = ref<HaWeatherDisplay | null>(null)

  const haEnabled = computed(() => state.value.features?.ha === true || state.value.ha_direct_connected === true
    || !!state.value.ui_config?.home_buttons?.length || !!state.value.ha_filtered)
  const haConnected = computed(() => !!state.value.ha_direct_connected)

  const waterValveState = computed(() =>
    state.value.water_valve === undefined ? undefined : coerceBool(state.value.water_valve)
  )
  const pumpSwitchState = computed(() =>
    state.value.pump_switch === undefined ? undefined : coerceBool(state.value.pump_switch)
  )

  const dishwasherRunning = computed(() => {
    if (state.value.dishwasher_running !== undefined)
      return coerceBool(state.value.dishwasher_running)
    const power = state.value.loads?.dishwasher
    return power === undefined ? undefined : (power as number) > 10
  })

  const washerRunning = computed(() => {
    if (state.value.washer_time !== undefined) return state.value.washer_time > 0
    if (state.value.washer_power !== undefined) return appliancePowerActive(state.value.washer_power)
    const power = state.value.loads?.washer
    return power === undefined ? undefined : (power as number) > 10
  })

  const dryerRunning = computed(() => {
    if (state.value.dryer_time !== undefined) return state.value.dryer_time > 0
    if (state.value.dryer_power !== undefined) return appliancePowerActive(state.value.dryer_power)
    const power = state.value.loads?.dryer
    return power === undefined ? undefined : (power as number) > 10
  })

  const publicMode = isPublicMode()

  const homeButtons = computed(() => {
    if (publicMode) return []
    const uiConfig = state.value.ui_config || {}
    return (uiConfig.home_buttons || []).filter(button => button.enabled !== false)
  })

  const headerToggles = computed(() => {
    if (publicMode) return []
    const uiConfig = state.value.ui_config || {}
    // An explicit empty list is a deliberate user/daemon choice.
    return uiConfig.header_toggles ?? DEFAULT_INVERTER_CONTROLS
  })

  const buttonStates = computed(() => {
    const states: Record<string, string> = {}
    homeButtons.value.forEach(
      (btn: { id: string; label: string; entity: string; state_key?: string }) => {
        const stateKey = btn.state_key || `home_${btn.id}`
        states[btn.id] = controlBooleanState(state.value.booleans?.[stateKey])
      }
    )
    return states
  })

  const headerToggleStates = computed(() => {
    const states: Record<string, string> = {}
    const mqttBooleans = (state.value.booleans || {}) as Record<string, unknown>
    // Same as inverter-desktop: 7 control flags always read Cerbo MQTT booleans,
    // never HA binary_sensor / input_boolean mirrors.
    headerToggles.value.forEach((toggle: { id: string; label: string; entity: string }) => {
      states[toggle.id] = resolveHeaderToggleState(toggle, mqttBooleans)
    })
    return states
  })

  // HA lifecycle: rich entity cards follow state.ha_filtered pushed by the backend.
  const stopFilteredWatch = watch(
    () => state.value.ha_filtered,
    (filtered) =>
      populateFiltered(
        {
          sensors: haSensors,
          numbers: haNumbers,
          covers: haCovers,
          mediaPlayers: haMediaPlayers,
          scenes: haScenes,
          weather: haWeather,
        },
        filtered
      ),
    { immediate: true, deep: true }
  )

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  function initHa() {}
  function cleanupHa() {
    stopFilteredWatch()
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  function setWindowHidden(_hidden: boolean) {}

  return {
    haEnabled,
    haConnected,
    haEntityStates: ref<Record<string, string>>({}),
    haEntityAttributes: ref<Record<string, Record<string, unknown>>>({}),
    homeButtons,
    headerToggles,
    buttonStates,
    headerToggleStates,
    waterValveState,
    pumpSwitchState,
    haSensors,
    haNumbers,
    haCovers,
    haMediaPlayers,
    haScenes,
    haWeather,
    dishwasherRunning,
    washerRunning,
    dryerRunning,
    coerceBool,
    initHa,
    sendHaOrMqtt: () => {},
    cleanupHa,
    setWindowHidden,
  }
}
