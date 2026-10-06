import { ref, shallowRef } from 'vue'
import type { SetpointOverrideStatus } from '../setpointOverride'
import type { EssModeState } from '../essMode'
import type { GridEnergyDaily } from '../components/dailyGridEnergy'
import type { DashboardControl } from '../utils'
import type {
  HaCoverDisplay,
  HaMediaPlayerDisplay,
  HaNumberDisplay,
  HaSceneDisplay,
  HaSensorDisplay,
  HaWeatherDisplay,
} from '../types/ha'

export interface GridBackupStatus {
  service?: string | null
  available: boolean
  enabled: boolean
  power?: number | null
}

export interface InverterState {
  data_source?: string
  mqtt_connected?: boolean
  gateway_connected?: boolean
  native_connected?: boolean
  telemetry?: {
    source?: string | null
    observed_at?: string | number | null
    timestamp_source?: 'local_receipt' | 'gateway_observation'
    quality?: 'live' | 'stale' | 'unknown'
  }
  gt?: number
  g1?: number
  g2?: number
  g3?: number
  grid_l1_available?: boolean
  grid_l2_available?: boolean
  grid_l3_available?: boolean
  grid_backup?: GridBackupStatus | null
  grid_using_backup?: boolean
  grid_backup_observed_at?: number | null
  tt?: number
  t1?: number
  t2?: number
  t3?: number
  telemetry_available?: Record<string, boolean>
  solar_total?: number
  mppt_total?: number
  pv_inverter_total?: number
  battery_soc?: number
  battery_power?: number
  battery_voltage?: number
  battery_current?: number
  setpoint?: number
  setpoint_override?: SetpointOverrideStatus | null
  setpoint_override_controls_available?: boolean
  setpoint_override_observed_at?: number | null
  inverter_state?: string
  version?: string
  uptime?: number
  ha_connected?: boolean
  ha_direct_connected?: boolean
  ha_controls_available?: boolean
  ha_observed_at?: number | null
  dry_run?: boolean
  controller_controls_available?: boolean
  electricity_tariff_controls_available?: boolean
  electricity_tariff_observed_at?: number | null
  ess_mode?: EssModeState & { hub4_mode?: number; battery_life_state?: number }
  ess_mode_controls_available?: boolean
  ess_mode_observed_at?: number | null
  booleans?: Record<string, unknown>
  features?: Record<string, boolean>
  mppt_individual?: number[]
  mppt_chargers?: Array<{
    instance?: string | number
    name?: string
    pv_voltage?: number
    current?: number
    power?: number
    telemetry_available?: Record<string, boolean>
  }>
  // AC PV inverters of any vendor (V/I/P per device)
  pv_inverters?: Array<{
    instance?: string | number
    name?: string
    voltage?: number
    pv_voltage?: number
    current?: number
    power?: number
    telemetry_available?: Record<string, boolean>
  }>
  batteries?: Array<{
    instance?: string | number
    telemetry_available?: Record<string, boolean>
    name?: string
    voltage?: number
    current?: number
    power?: number
    soc?: number
    state?: string
    time_to_go?: string
  }>
  loads?: Record<string, number>
  load_names?: Record<string, string>
  ui_config?: {
    electricity_tariff?: unknown
    electricity_tariff_status?: { writable?: boolean; revision?: string; request_id?: string | null; error?: string | null }
    loads?: { hidden?: string[]; min_watts?: number }
    home_buttons?: Array<{ id: string; label: string; entity: string; state_key?: string; enabled?: boolean }>
    header_toggles?: DashboardControl[]
    // Runtime-editable settings persisted via /api/settings or WS set_settings
    settings?: {
      camera_topic?: string
      // Connection overrides (secrets masked as "***" in payloads)
      mqtt_host?: string
      mqtt_port?: number
      mqtt_username?: string
      mqtt_password?: string
      ha_url?: string
      ha_token?: string
      show_daily_stats?: boolean
      show_ha_sensors?: boolean
      show_ha_numbers?: boolean
      show_ev?: boolean
      show_washer?: boolean
      show_dryer?: boolean
      show_dishwasher?: boolean
      show_home_section?: boolean
      show_header_toggles?: boolean
      show_batteries?: boolean
      show_solar_production?: boolean
      show_active_loads?: boolean
      show_ha_covers?: boolean
      show_ha_media?: boolean
      show_ha_scenes?: boolean
      show_ha_weather?: boolean
    }
  }
  solar_forecast?: {
    date?: string
    generated_at?: string
    today_kwh?: number
    tomorrow_kwh?: number
  }
  notifications?: Array<{
    id: string
    level: string
    title: string
    body?: string
    source?: string
    ts?: string
  }>
  // Latest camera event from the optional Frigate topic: {camera, url, ts}
  camera_event?: {
    camera?: string
    url?: string
    ts?: string
  }
  // Rich HA entity displays pushed by the backend (matches HaFilteredData)
  ha_filtered?: {
    sensors?: HaSensorDisplay[]
    numbers?: HaNumberDisplay[]
    covers?: HaCoverDisplay[]
    media_players?: HaMediaPlayerDisplay[]
    scenes?: HaSceneDisplay[]
    weather?: HaWeatherDisplay | null
  }
  daily_stats?: {
    produced_today?: number
    produced_yesterday?: number
    produced_dollars?: number
    grid_kwh?: number | null
    grid_energy?: GridEnergyDaily | null
    battery_in?: number
    battery_out?: number
    battery_in_yesterday?: number
    battery_out_yesterday?: number
    pv_inverter_daily?: number[]
    mppt_daily?: number[]
    pv_total_daily?: number
  }
  ev_charging_kw?: number
  ev_power?: number
  ev_charging_power?: number
  car_charging_power?: number
  ev_present?: boolean
  evcharger_present?: boolean
  discovered_water_ev?: Array<{ kind: string; instance: number; name?: string }>
  car_soc?: number
  water_controls_available?: boolean
  water_pump_controls_available?: boolean
  water_valve_controls_available?: boolean
  water_pump_mode?: number
  pump_mode?: number
  water_valve_mode?: number
  water_level?: number
  water_valve?: boolean
  pump_switch?: boolean
  dishwasher_running?: boolean
  dishwasher_duration?: number
  washer_time?: number
  washer_power?: boolean | number
  dryer_time?: number
  dryer_power?: boolean | number
  latest_version?: string
  dashboard_version?: string
}

export const state = shallowRef<InverterState>({
  booleans: {},
  features: {},
  loads: {},
  ui_config: {},
})

export const mqttConnected = ref(false)
export const haMqttConnected = ref<boolean | null>(null)
