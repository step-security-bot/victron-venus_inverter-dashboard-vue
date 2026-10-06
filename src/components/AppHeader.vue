<template>
  <div class="classic-card mb-1.5 p-1 flex items-center gap-1 w-full">
    <div class="flex flex-wrap gap-0.5 items-center flex-1">
      <template v-if="readOnly">
        <span class="classic-status text-[9px] font-bold uppercase tracking-tight opacity-80"
          >PUBLIC · READ-ONLY</span
        >
        <span
          v-if="essText"
          class="classic-status"
          :class="{ 'classic-status-on': essClass === 'on' }"
          ><Zap :size="7" /> {{ essText.toUpperCase() }}</span
        >
      </template>
      <template v-else>
        <button
          type="button"
          class="classic-btn min-w-[28px]"
          :class="{ 'classic-btn-on': dryRun }"
          :disabled="commandPending || controlsAvailable === false || dryRun === undefined"
          :aria-pressed="dryRun"
          :title="dryRun === undefined ? 'Controller state unavailable' : 'Dry run'"
          @click="$emit('send', 'dry_run', { value: !dryRun })"
        >
          <FlaskConical :size="7" /> DRY
        </button>

        <EssModeMenu
          :mode="essMode"
          :label="essText"
          :active="essClass === 'on'"
          :dry-run="dryRun"
          :connected="controlsAvailable"
          :fresh="essFresh"
          :controls-available="essControlsAvailable"
          :command-error="commandError"
          @send="(action, payload) => emit('send', action, payload)"
        />

        <template v-if="showHeaderToggles !== false && headerToggles.length > 0">
          <div class="w-px h-3 bg-slate-300 mx-0.5"></div>

          <button
            type="button"
            v-for="toggle in headerToggles"
            :key="toggle.id"
            class="classic-btn min-w-[55px]"
            :class="{ 'classic-btn-on': toggleStates?.[toggle.id] === 'on' }"
            :disabled="toggleUnavailable(toggle)"
            :aria-pressed="toggleUnavailable(toggle) ? undefined : toggleStates?.[toggle.id] === 'on'"
            :title="toggleUnavailable(toggle) ? 'Controller state unavailable' : toggle.label"
            @click="sendToggle(toggle)"
          >
            {{ toggle.label.toUpperCase() }}
          </button>
        </template>
      </template>
    </div>

    <button
      v-if="!readOnly"
      type="button"
      class="classic-btn min-w-[20px]"
      aria-label="Settings"
      @click="$emit('open-settings')"
    >
      <Settings :size="8" />
    </button>
    <button type="button" class="classic-btn min-w-[20px]" @click="$emit('toggle-theme')">
      <Sun v-if="isDark" :size="8" />
      <Moon v-else :size="8" />
    </button>
    <NotificationHistory v-if="!readOnly" />
  </div>
</template>

<script setup lang="ts">
import { FlaskConical, Moon, Settings, Sun, Zap } from '@lucide/vue'
import { type DashboardControl, inverterControlFlagKey } from '../utils'
import EssModeMenu from './EssModeMenu.vue'
import type { EssModeState, EssModeCommandError } from '../essMode'
import NotificationHistory from './NotificationHistory.vue'

const props = withDefaults(defineProps<{
  dryRun?: boolean
  essClass: string
  essText: string
  essMode?: EssModeState
  essFresh?: boolean
  essControlsAvailable?: boolean
  commandError?: EssModeCommandError | null
  headerToggles: DashboardControl[]
  toggleStates: Record<string, string> | undefined
  isDark: boolean
  showHeaderToggles?: boolean
  controlsAvailable?: boolean
  haControlsAvailable?: boolean
  commandPending?: boolean
  /** Public / here.now: status display only — no command buttons. */
  readOnly?: boolean
}>(), { dryRun: undefined, showHeaderToggles: true, controlsAvailable: true })

const emit = defineEmits<{
  send: [action: string, payload?: Record<string, unknown>]
  'toggle-theme': []
  'open-settings': []
}>()

function toggleUnavailable(toggle: DashboardControl): boolean {
  const value = props.toggleStates?.[toggle.id]
  return props.commandPending === true
    || (inverterControlFlagKey(toggle.entity) !== null ? props.controlsAvailable === false : props.haControlsAvailable !== true)
    || (value !== 'on' && value !== 'off')
}

function sendToggle(toggle: DashboardControl) {
  if (toggleUnavailable(toggle)) return
  const flag = inverterControlFlagKey(toggle.entity)
  emit('send', 'toggle', {
    entity: flag ?? toggle.entity,
    ...(flag ? { state: props.toggleStates?.[toggle.id] === 'on' ? 'off' : 'on' } : {}),
  })
}
</script>
