import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { createEssRequestId, type EssModeCommandError } from '../essMode'
import { validatePlan, type TariffPlan } from '../tariffs/model'

export interface ControllerTariffState {
  data_source?: string
  electricity_tariff_observed_at?: number | null
  electricity_tariff_controls_available?: boolean
  ui_config?: {
    electricity_tariff?: unknown
    electricity_tariff_status?: {
      writable?: boolean
      revision?: string
      request_id?: string | null
      error?: string | null
    }
  }
}

function canonicalPlan(value: unknown): string {
  return JSON.stringify(value === null ? null : validatePlan(value))
}

/** A transport receipt is not proof that the controller durably saved a tariff. */
export function useControllerTariff(options: {
  state: Ref<ControllerTariffState>
  connected: Ref<boolean>
  readOnly: boolean
  commandError: Ref<EssModeCommandError | null>
  send: (action: string, payload: Record<string, unknown>) => boolean
}) {
  const clock = ref(Date.now())
  const operation = ref<{
    id: string; source?: string; expectedPlan: string; expiresAt: number
    resolve: () => void; reject: (error: Error) => void
  } | null>(null)
  const status = computed(() => options.state.value.ui_config?.electricity_tariff_status)
  const revision = computed(() => status.value?.revision ?? '')
  function isWritable(now: number) {
    const observed = options.state.value.electricity_tariff_observed_at
    const age = typeof observed === 'number' ? now / 1000 - observed : Infinity
    return !options.readOnly && options.connected.value
      && options.state.value.electricity_tariff_controls_available === true
      && status.value?.writable === true && /^[a-f0-9]{64}$/.test(revision.value)
      && Number.isFinite(age) && age >= 0 && age <= 30
  }
  const writable = ref(false)
  watch([clock, options.state, options.connected], () => {
    writable.value = isWritable(Date.now())
  }, { immediate: true, flush: 'sync' })
  const pending = computed(() => operation.value !== null)
  let deadline: ReturnType<typeof setTimeout> | undefined
  const clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)

  function finish(error?: string) {
    const request = operation.value
    operation.value = null
    clearTimeout(deadline)
    deadline = undefined
    if (!request) return
    if (error) request.reject(new Error(error))
    else request.resolve()
  }
  function inspect() {
    const request = operation.value
    if (!request) return
    if (Date.now() >= request.expiresAt) {
      finish('The controller has not confirmed the tariff. Reload its current tariff before trying again.')
      return
    }
    if (!isWritable(Date.now()) || request.source !== options.state.value.data_source) {
      finish('Connection or tariff support changed. The result is unknown; reload the controller tariff before retrying.')
      return
    }
    const current = status.value
    if (current?.request_id !== request.id) return
    if (current.error !== null) {
      finish(current.error || 'The controller did not confirm a successful tariff write.')
      return
    }
    try {
      if (canonicalPlan(options.state.value.ui_config?.electricity_tariff) !== request.expectedPlan) {
        finish('The controller confirmed a different tariff. Reload its current tariff before retrying.')
        return
      }
    } catch {
      finish('The controller returned an invalid tariff. Reload its current tariff before retrying.')
      return
    }
    finish()
  }
  async function save(plan: TariffPlan | null, expectedRevision: string): Promise<void> {
    if (pending.value) throw new Error('A controller tariff write is already pending.')
    if (!isWritable(Date.now())) throw new Error('Controller tariff editing is unavailable.')
    if (expectedRevision !== revision.value) throw new Error('The controller tariff changed. Reopen the editor before saving.')
    const validated = plan === null ? null : validatePlan(plan)
    const id = createEssRequestId()
    const body = { plan: validated, revision: expectedRevision, request_id: id }
    if (new TextEncoder().encode(JSON.stringify(body)).length > 100000)
      throw new Error('Controller tariff command exceeds 100000 bytes.')
    return new Promise<void>((resolve, reject) => {
      operation.value = { id, source: options.state.value.data_source, expectedPlan: canonicalPlan(validated), expiresAt: Date.now() + 10000, resolve, reject }
      deadline = setTimeout(() => finish('The controller has not confirmed the tariff. Reload its current tariff before trying again.'), 10000)
      try {
        if (!options.send('electricity_tariff', body)) finish('Controller connection is unavailable. No change was sent.')
      } catch {
        finish('The tariff write could not be confirmed. Reload its current value before trying again.')
      }
    })
  }
  watch([options.state, options.connected, writable], inspect, { flush: 'sync' })
  watch(options.commandError, error => {
    if (operation.value && error?.action === 'electricity_tariff' && error.request_id === operation.value.id)
      finish(error.error || 'The server rejected the tariff write.')
  }, { flush: 'sync' })
  onScopeDispose(() => {
    clearInterval(clockTimer)
    finish('The editor connection closed. The tariff write result is unknown; reload before retrying.')
  })
  return { writable, revision, pending, save }
}
