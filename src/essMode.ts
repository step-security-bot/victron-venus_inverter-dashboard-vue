export const ESS_MODES = [
  { id: 'off', label: 'Off', short: 'Off' },
  { id: 'on', label: 'On', short: 'On' },
  {
    id: 'optimized_with_battery_life',
    label: 'Optimized with battery life',
    short: 'Optimized · BL',
  },
  {
    id: 'optimized_without_battery_life',
    label: 'Optimized without battery life',
    short: 'Optimized',
  },
  { id: 'keep_batteries_charged', label: 'Keep batteries charged', short: 'Keep charged' },
  { id: 'external_control', label: 'External control', short: 'External' },
] as const
export type EssModeId = (typeof ESS_MODES)[number]['id']
export interface EssModeState {
  mode_name?: string
  is_external?: boolean
  selected?: EssModeId | null
  vebus_mode?: number | null
  selection_supported?: boolean
  request_id?: string | null
  error?: string | null
}

/** Matches the backend set_ess_mode live-observation window (seconds). */
export const ESS_MODE_COMMAND_FRESH_WITHIN_S = 30

/** UUID v4 correlation ID, including LAN HTTP where randomUUID is unavailable. */
export function createEssRequestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * True only when a live (non-retained) ESS observation is recent enough for
 * set_ess_mode. Retained inverter/state leaves ess_mode_observed_at unset.
 */
export function isEssModeCommandFresh(
  mode: EssModeState | undefined,
  observedAtSeconds: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!mode) return false
  if (observedAtSeconds == null || !Number.isFinite(observedAtSeconds)) return false
  const ageS = nowMs / 1000 - observedAtSeconds
  return ageS >= 0 && ageS <= ESS_MODE_COMMAND_FRESH_WITHIN_S
}

/** Controller mode_name strings that do not match ESS_MODES[].label exactly. */
const MODE_NAME_ALIASES: Record<string, EssModeId> = {
  off: 'off',
  on: 'on',
  'optimized (batterylife)': 'optimized_with_battery_life',
  'optimized with battery life': 'optimized_with_battery_life',
  'optimized without batterylife': 'optimized_without_battery_life',
  'optimized without battery life': 'optimized_without_battery_life',
  'keep batteries charged': 'keep_batteries_charged',
  'external control': 'external_control',
}

export function selectedEssMode(mode?: EssModeState): EssModeId | undefined {
  if (!mode) return undefined
  // A capable controller owns the selection, including unknown switch states.
  if (mode.selection_supported) return ESS_MODES.find((item) => item.id === mode.selected)?.id
  if (mode.mode_name === 'Off') return 'off'
  if (mode.is_external) return 'external_control'
  const name = mode.mode_name?.trim().toLowerCase()
  if (!name) return undefined
  const aliased = MODE_NAME_ALIASES[name]
  if (aliased) return aliased
  return ESS_MODES.find((item) => item.label.toLowerCase() === name)?.id
}

export interface EssModeCommandError {
  action: string
  request_id: string
  error: string
}
