import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadTariff, tariffKey, LOCAL_TARIFF_EVENT } from './storage'
import type { TariffPlan } from './model'

export type TariffMode = 'controller' | 'local'
export const tariffModeKey = (scope: string) => `victron.energy-tariff-mode.v1:${scope}`

export function setTariffMode(scope: string, mode: TariffMode) {
  try {
    localStorage.setItem(tariffModeKey(scope), mode)
  } catch {
    throw new Error('The tariff preference could not be saved on this device.')
  }
  window.dispatchEvent(new CustomEvent(LOCAL_TARIFF_EVENT, { detail: scope }))
}

/** Settings, summary and other tabs all read the same scoped, persisted choice. */
export function useLocalTariff(scope: () => string) {
  const mode = ref<TariffMode>('controller')
  const plan = ref<TariffPlan | null>(null)
  const error = ref('')
  function load() {
    try {
      const saved = localStorage.getItem(tariffModeKey(scope()))
      if (saved !== null && saved !== 'controller' && saved !== 'local') throw new Error()
      mode.value = saved === 'local' ? 'local' : 'controller'
      const value = loadTariff(scope())
      plan.value = value.plan
      error.value = value.error
    } catch {
      mode.value = 'controller'
      plan.value = null
      error.value = 'The tariff preference could not be loaded on this device.'
    }
  }
  function storageChanged(event: StorageEvent) {
    if ([null, tariffKey(scope()), tariffModeKey(scope())].includes(event.key)) load()
  }
  function localChanged(event: Event) {
    if ((event as CustomEvent<string>).detail === scope()) load()
  }
  watch(scope, load, { immediate: true })
  onMounted(() => {
    window.addEventListener('storage', storageChanged)
    window.addEventListener(LOCAL_TARIFF_EVENT, localChanged)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('storage', storageChanged)
    window.removeEventListener(LOCAL_TARIFF_EVENT, localChanged)
  })
  return { mode, plan, error }
}
