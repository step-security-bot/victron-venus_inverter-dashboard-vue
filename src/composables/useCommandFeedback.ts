import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { createEssRequestId, type EssModeCommandError } from '../essMode'

export interface CommandResult { action: string; request_id: string; status: 'accepted' }

/** Transport acceptance is not a physical state acknowledgement. Never changes telemetry. */
export function useCommandFeedback(
  connected: Ref<boolean>,
  error: Ref<EssModeCommandError | null>,
  result: Ref<CommandResult | null>,
  send: (action: string, payload: Record<string, unknown>) => boolean,
) {
  const pending = ref<{ action: string; request_id: string; deadline: number } | null>(null)
  const message = ref('')
  const failed = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const busy = computed(() => pending.value !== null)
  function finish(text: string, failure: boolean) {
    clearTimeout(timer)
    pending.value = null
    message.value = text
    failed.value = failure
  }
  function refuse() {
    finish('Control is unavailable. No change was sent.', true)
  }
  function submit(action: string, payload: Record<string, unknown>) {
    if (pending.value) return
    if (!connected.value) { refuse(); return }
    try {
      const request_id = createEssRequestId()
      pending.value = { action, request_id, deadline: Date.now() + 10000 }
      message.value = 'Sending command…'
      failed.value = false
      timer = setTimeout(() => finish('No server confirmation. Check the current state before trying again.', true), 10000)
      if (!send(action, { ...payload, request_id })) refuse()
    } catch {
      refuse()
    }
  }
  function matches(value: { action: string; request_id: string } | null) {
    return pending.value && value?.action === pending.value.action && value?.request_id === pending.value.request_id
  }
  watch(error, value => { if (matches(value)) finish('The server rejected the command. Check the connection and current state.', true) })
  watch(result, value => {
    if (!connected.value || !matches(value)) return
    if (Date.now() >= pending.value!.deadline) {
      finish('No timely server confirmation. Check the current state before trying again.', true)
      return
    }
    finish('Command accepted by server. Device state is shown by live telemetry.', false)
  })
  watch(connected, value => {
    if (!value && pending.value) finish('Connection lost. Command outcome is unknown; check the current state.', true)
  })
  onScopeDispose(() => clearTimeout(timer))
  return { busy, message, failed, submit, refuse }
}
