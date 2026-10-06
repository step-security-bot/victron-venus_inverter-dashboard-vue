<template>
  <section aria-label="System notifications" class="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-300">
    <h3 class="font-bold text-slate-200">System notifications</h3>
    <output class="block mt-1" aria-live="polite">{{ notifications.status.value }}</output>
    <p class="mt-1 text-slate-400">Browser permission: {{ notifications.permission.value }}.</p>
    <p class="mt-1 text-slate-400">Notifications use server push, including when this tab is closed, where your browser and OS allow it. Event text includes the original occurrence time.</p>
    <p v-if="!notifications.supported.value" class="mt-2">Use HTTPS and a browser with Web Push. On iPhone or iPad, add this dashboard to the Home Screen, open that app, then enable notifications.</p>
    <p v-if="notifications.permission.value === 'denied'" class="mt-2">Allow notifications for this site in browser or system settings, then refresh status. The dashboard cannot change this permission.</p>
    <p v-if="notifications.supported.value && !notifications.server.value?.available" class="mt-2">The dashboard server must have Web Push configured before notifications can be enabled.</p>
    <div class="mt-2 space-y-1">
      <label v-for="category in categories" :key="category.key" class="flex gap-2 items-center">
        <input v-model="notifications.preferences.value[category.key]" type="checkbox" :disabled="notifications.busy.value" />
        {{ category.label }}
      </label>
    </div>
    <div class="flex flex-wrap gap-2 mt-2">
      <button type="button" class="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" :disabled="notifications.busy.value || !notifications.supported.value || !notifications.server.value?.available || notifications.permission.value === 'denied' || notifications.ready.value" @click="notifications.enable">Enable</button>
      <button type="button" class="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" :disabled="notifications.busy.value || !notifications.supported.value" @click="notifications.disable">Disable</button>
      <button type="button" class="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" :disabled="notifications.busy.value || !notifications.ready.value" @click="notifications.savePreferences">Save categories</button>
      <button type="button" class="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" :disabled="notifications.busy.value || !notifications.ready.value" @click="notifications.test">Send test</button>
      <button type="button" class="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" :disabled="notifications.busy.value" @click="notifications.refresh">Refresh status</button>
    </div>
    <p v-if="notifications.error.value" role="alert" class="mt-2 text-red-300">{{ notifications.error.value }}</p>
    <output v-if="notifications.notice.value" aria-live="polite" class="block mt-2">{{ notifications.notice.value }}</output>
  </section>
</template>
<script setup lang="ts">
import { onMounted } from 'vue'
import { useSystemNotifications } from '../composables/useSystemNotifications'
const notifications = useSystemNotifications()
const categories = [
  { key: 'native', label: 'Native Victron warnings and alarms' },
  { key: 'ev', label: 'EV charging start and stop' },
  { key: 'water', label: 'Water pump and valve changes' },
  { key: 'lowBattery', label: 'Battery at or below 20%' },
] as const
onMounted(() => { void notifications.refresh() })
</script>
