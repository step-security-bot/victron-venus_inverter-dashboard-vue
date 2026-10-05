<template>
  <div class="notification-bell relative shrink-0">
    <button type="button" class="classic-btn relative" @click="showPanel = !showPanel">
      🔔
      <span
        v-if="unreadCount > 0"
        class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold"
      >
        {{ unreadCount > 9 ? '9+' : unreadCount }}
      </span>
    </button>

    <div
      v-if="showPanel"
      class="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-y-auto classic-card z-50"
    >
      <div
        class="flex items-center justify-between px-2 py-1 border-b border-slate-200 dark:border-slate-700"
      >
        <span class="text-[10px] font-bold text-slate-500 uppercase">{{
          $t('notifications.title')
        }}</span>
        <div class="flex gap-1">
          <button
            v-if="historyNotifications.length > 0"
            type="button"
            class="text-[9px] text-blue-500 hover:underline"
            @click="markAllNotificationsRead()"
          >
            {{ $t('notifications.markAllRead') }}
          </button>
          <button
            v-if="historyNotifications.length > 0"
            type="button"
            class="text-[9px] text-red-500 hover:underline"
            @click="clearNotifications()"
          >
            {{ $t('notifications.clear') }}
          </button>
        </div>
      </div>
      <div
        v-if="historyNotifications.length === 0"
        class="px-2 py-3 text-[10px] text-slate-400 text-center"
      >
        {{ $t('notifications.noNotifications') }}
      </div>
      <button
        type="button"
        v-for="n in historyNotifications"
        :key="JSON.stringify([n.id, n.timestamp])"
        class="block w-full text-left px-2 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
        :class="{ 'opacity-50': n.read }"
        @click="markNotificationRead(n.id, n.timestamp)"
      >
        <span class="flex items-start justify-between gap-1">
          <span class="text-[10px] font-bold text-slate-700 dark:text-slate-300">{{
            n.title
          }}</span>
          <span class="text-[8px] text-slate-400 whitespace-nowrap ml-1"
            :title="n.timestamp === null ? undefined : exactNotificationTime(n.timestamp)">{{
            formatTime(n.timestamp)
          }}</span>
        </span>
        <span class="block text-[9px] text-slate-500 truncate">{{ n.body }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { exactNotificationTime } from '../notificationTime'
import {
  clearNotifications,
  historyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from '../composables/useNotifications'

const { t: $t } = useI18n()
const showPanel = ref(false)
const unreadCount = computed(() => unreadNotificationCount())

function formatTime(ts: number | null): string {
  if (ts === null) return $t('notifications.timeUnavailable')
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function onClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.notification-bell')) {
    showPanel.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>
