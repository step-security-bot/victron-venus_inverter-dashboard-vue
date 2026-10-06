<template>
  <span class="inline-flex items-center gap-1 normal-case">
    <button type="button" class="classic-btn !px-1" aria-label="Setpoint override"
      title="Setpoint override" aria-haspopup="dialog" :aria-expanded="opened"
      :aria-pressed="ready ? active : undefined" :disabled="readOnly" @click="open">
      <SlidersHorizontal :size="11" aria-hidden="true" />
    </button>
    <output v-if="active" class="text-[9px] text-accent whitespace-nowrap">
      {{ ready ? '' : 'Last known: ' }}{{ status?.value }} W · 2s
    </output>
    <span v-else-if="!ready" class="text-[9px] text-slate-500 dark:text-slate-400">Status unknown</span>
    <span v-if="error && !opened" class="text-[9px] text-consumption" role="alert">{{ error }}</span>
  </span>
  <Teleport to="body">
    <ModalDialog :open="opened" label="Setpoint override" class="z-[1000] bg-black/35 flex items-center justify-center p-4" @close="close">
      <section class="classic-card p-4 w-full max-w-sm">
        <h2 class="text-sm font-semibold">Setpoint override</h2>
        <p class="mt-2 text-xs">
          Cerbo applies this setpoint every 2 seconds until stopped, even after this page closes.
          Positive = import; negative = export.
        </p>
        <output v-if="!ready" class="block mt-2 text-xs">
          Current override status is unavailable. Wait for a live controller connection with override support.
        </output>
        <form class="mt-3" novalidate @submit.prevent="submit">
          <label class="block text-xs">
            Watts
            <input v-model="draft" aria-label="Watts" type="text" inputmode="decimal"
              class="classic-input w-full mt-1" :disabled="!!pending" :aria-invalid="inputError ? true : undefined"
              @input="inputError = ''" />
          </label>
          <output v-if="pending" class="block mt-2 text-xs">Waiting for the controller to confirm…</output>
          <p v-if="error" class="mt-2 text-xs text-consumption break-words" role="alert">{{ error }}</p>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button v-if="active" type="button" class="classic-btn mr-auto" :disabled="!ready || !!pending" @click="apply(null)">Stop override</button>
            <button type="button" class="classic-btn" @click="close">Cancel</button>
            <button type="submit" class="classic-btn" :disabled="!ready || !!pending">OK</button>
          </div>
        </form>
      </section>
    </ModalDialog>
  </Teleport>
</template>

<script setup lang="ts">
import { SlidersHorizontal } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createEssRequestId, type EssModeCommandError } from '../essMode'
import { isSetpointOverrideFresh, type SetpointOverrideStatus } from '../setpointOverride'
import ModalDialog from './ModalDialog.vue'

const props = defineProps<{
  status?: SetpointOverrideStatus | null
  observedAt?: number | null
  source?: string
  currentSetpoint?: number
  connected: boolean
  available: boolean
  readOnly?: boolean
  commandError?: EssModeCommandError | null
}>()
const emit = defineEmits<{ send: [action: string, payload: Record<string, unknown>] }>()
const opened = ref(false)
const draft = ref('')
const inputError = ref('')
const operationError = ref('')
const clock = ref(Date.now())
const pending = ref<{ requestId: string; value: number | null; expiresAt: number; source?: string } | null>(null)
let clockTimer: ReturnType<typeof setInterval> | undefined
let deadline: ReturnType<typeof setTimeout> | undefined

function int32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
}
const valid = computed(() => {
  const status = props.status
  return !!status && (status.value === null || int32(status.value)) &&
    (status.last_error === null || typeof status.last_error === 'string') &&
    (status.request_id === null || typeof status.request_id === 'string')
})
const ready = ref(false)
watch([clock, () => props.status, () => props.observedAt, () => props.readOnly, () => props.connected, () => props.available], () => {
  ready.value = !props.readOnly && props.connected && props.available &&
    isSetpointOverrideFresh(props.status, props.observedAt)
}, { immediate: true, flush: 'sync' })
const active = computed(() => valid.value && props.status?.value !== null)
const error = computed(() => inputError.value || operationError.value || (!pending.value ? props.status?.last_error : ''))

function clearPending() {
  pending.value = null
  clearTimeout(deadline)
  deadline = undefined
}
function fail(message: string) {
  clearPending()
  operationError.value = message
}
function open() {
  if (props.readOnly) return
  const value = props.status?.value ?? props.currentSetpoint
  draft.value = typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  inputError.value = ''
  if (!pending.value) operationError.value = ''
  opened.value = true
}
function close() {
  // Closing the UI never cancels or repeats a command already sent to Cerbo.
  opened.value = false
}
function submit() {
  if (!ready.value || pending.value) return
  const text = draft.value.trim()
  const value = Number(text)
  if (!/^[+-]?\d+$/.test(text) || !int32(value)) {
    inputError.value = 'Enter a whole number of watts from -2147483648 to 2147483647.'
    return
  }
  apply(value)
}
function apply(value: number | null) {
  clock.value = Date.now()
  if (!ready.value || pending.value) return
  inputError.value = ''
  operationError.value = ''
  let requestId: string
  try { requestId = createEssRequestId() }
  catch { operationError.value = 'A request identifier could not be created. No change was sent.'; return }
  pending.value = { requestId, value, expiresAt: Date.now() + 10000, source: props.source }
  deadline = setTimeout(() => {
    fail('Change unconfirmed. Check the controller connection and current override before trying again.')
  }, 10_000)
  emit('send', 'set_setpoint_override', { value, request_id: requestId })
}
watch([ready, () => props.status, () => props.source], () => {
  const request = pending.value
  if (!request) return
  if (Date.now() >= request.expiresAt) {
    fail('Change unconfirmed. Check the controller connection and current override before trying again.')
    return
  }
  if (!ready.value || request.source !== props.source) {
    fail('Connection or override status changed. The result is unknown; check the controller before trying again.')
    return
  }
  const status = props.status
  if (status?.request_id !== request.requestId) return
  if (status.last_error !== null || status.value !== request.value) {
    fail(status.last_error || 'The controller confirmed a different override value. Check its current status.')
    return
  }
  clearPending()
  opened.value = false
}, { deep: true, flush: 'post' })
watch(() => props.commandError, (message) => {
  if (pending.value && message?.action === 'set_setpoint_override' && message.request_id === pending.value.requestId)
    fail(message.error)
})
onMounted(() => { clockTimer = setInterval(() => { clock.value = Date.now() }, 1000) })
onBeforeUnmount(() => { clearInterval(clockTimer); clearPending() })
</script>
