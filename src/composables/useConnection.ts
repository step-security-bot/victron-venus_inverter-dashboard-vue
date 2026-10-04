import { markRaw, ref } from 'vue'
import { apiUrl, gatewaySnapshotUrl, isPublicMode } from '../config/publicMode'
import { logger } from '../logger'
import { connectionStatus, normalizeTelemetry } from '../telemetry'
import { addHistoryPoint } from './useChart'
import { type InverterState, mqttConnected, state } from './useInverterState'
import { type GatewaySnapshot, snapshotToState } from './publicGateway'

/** Page ?token= used by DASHBOARD_SECRET backends for /ws and /api/state. */
export function dashboardPageToken(): string | null {
  if (typeof location === 'undefined') return null
  try {
    const token = new URLSearchParams(location.search).get('token')
    return token && token.length > 0 ? token : null
  } catch {
    return null
  }
}

function withPageToken(url: string): string {
  const token = dashboardPageToken()
  if (!token) return url
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}token=${encodeURIComponent(token)}`
}

export function useConnection() {
  const commandConnected = ref(false)
  let ws: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastMessageTime = Date.now()
  const publicMode = isPublicMode()
  let publicActive = false
  let publicRequest: AbortController | null = null
  let publicExpiryTimer: ReturnType<typeof setTimeout> | null = null

  function processState(newState: InverterState) {
    newState = normalizeTelemetry(newState)
    state.value = markRaw(newState)
    addHistoryPoint({
      gt: newState.gt,
      solar_total: newState.solar_total,
      battery_power: newState.battery_power,
      setpoint: newState.setpoint,
    })
    return newState
  }

  async function pollPublicGateway() {
    if (!publicActive || publicRequest) return
    const request = new AbortController()
    publicRequest = request
    const requestTimer = setTimeout(() => request.abort(), 10000)
    try {
      const resp = await fetch(gatewaySnapshotUrl(), {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: request.signal,
      })
      if (!resp.ok || resp.redirected) return
      const snap: unknown = await resp.json()
      if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return
      const data = snapshotToState(snap as GatewaySnapshot)
      const hasTelemetry = [
        data.gt,
        data.tt,
        data.solar_total,
        data.battery_soc,
        data.battery_power,
      ].some((value) => typeof value === 'number' && Number.isFinite(value))
      if (!publicActive || request.signal.aborted) return
      processState(data)
      mqttConnected.value = hasTelemetry
      if (publicExpiryTimer) clearTimeout(publicExpiryTimer)
      // Keep the last snapshot visible, but never label an expired snapshot live.
      publicExpiryTimer = setTimeout(() => {
        mqttConnected.value = false
        publicExpiryTimer = null
      }, 15000)
    } catch {
      // The independent freshness deadline also covers failures and hung requests.
    } finally {
      clearTimeout(requestTimer)
      if (publicRequest === request) publicRequest = null
    }
  }

  async function pollHttpState() {
    if (disposed) return
    // Fallback when WS is down or silent: /api/state carries live tiles (1.8.17+).
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageTime < 8000) {
      return
    }
    try {
      const resp = await fetch(withPageToken(apiUrl('/api/state')), { cache: 'no-store' })
      if (!resp.ok) return
      const data = (await resp.json()) as InverterState & { ok?: boolean }
      if (disposed || !data || data.ok === false) return
      const normalized = processState(data)
      const connected = connectionStatus(data)
      if (connected !== undefined) {
        mqttConnected.value = connected
        if (connected) lastMessageTime = Date.now()
      } else if (typeof normalized.gt === 'number' || typeof normalized.battery_soc === 'number') {
        mqttConnected.value = true
        lastMessageTime = Date.now()
      }
    } catch {
      // ignore — WS reconnect path owns hard failures
    }
  }

  function startHttpPoll() {
    if (disposed || pollTimer) return
    const tick = publicMode ? pollPublicGateway : pollHttpState
    void tick()
    pollTimer = setInterval(() => {
      void tick()
    }, 3000)
  }

  function stopHttpPoll() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function connectPublic() {
    publicActive = true
    mqttConnected.value = false
    startHttpPoll()
  }

  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
  }

  function connectMqtt() {
    if (disposed) return
    if (publicMode) {
      connectPublic()
      return
    }

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    clearConnectTimer()
    startHttpPoll()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    let socket: WebSocket
    try {
      socket = new WebSocket(withPageToken(`${proto}//${location.host}/ws`))
      ws = socket
    } catch (e) {
      logger.error('WebSocket connection failed:', e)
      mqttConnected.value = false
      reconnectTimer = setTimeout(connectMqtt, 2000)
      return
    }

    socket.onopen = () => {
      if (disposed || ws !== socket) return
      clearConnectTimer()
      commandConnected.value = true
      logger.log('WebSocket connected')
      lastMessageTime = Date.now()
      startHeartbeat()
      startHttpPoll()
    }

    socket.onclose = () => {
      if (disposed || ws !== socket) return
      clearConnectTimer()
      ws = null
      commandConnected.value = false
      mqttConnected.value = false
      stopHeartbeat()
      reconnectTimer = setTimeout(connectMqtt, 2000)
    }

    socket.onerror = () => {
      if (disposed || ws !== socket) return
      commandConnected.value = false
      logger.error('WebSocket error')
      mqttConnected.value = false
      socket.close()
    }

    socket.onmessage = (e) => {
      if (disposed || ws !== socket) return
      lastMessageTime = Date.now()
      try {
        const data = JSON.parse(e.data) as InverterState
        processState(data)
        mqttConnected.value = connectionStatus(data) ?? true
      } catch (err) {
        logger.error('Failed to parse WS message:', err)
      }
    }
    connectTimer = setTimeout(() => {
      if (disposed || ws !== socket) return
      connectTimer = null
      if (socket.readyState === WebSocket.CONNECTING) socket.close()
    }, 10000)
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastMessageTime > 15000) {
        logger.log('No data received, reconnecting...')
        ws?.close()
      }
    }, 5000)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function send(action: string, payload: Record<string, unknown> = {}) {
    if (publicMode) {
      // Read-only public host — writes disabled
      return
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action, ...payload }))
    }
  }

  function closeSocket() {
    clearConnectTimer()
    const socket = ws
    ws = null
    if (!socket) return
    socket.onopen = null
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    socket.close()
  }

  function cleanup() {
    disposed = true
    commandConnected.value = false
    publicActive = false
    publicRequest?.abort()
    publicRequest = null
    if (publicExpiryTimer) {
      clearTimeout(publicExpiryTimer)
      publicExpiryTimer = null
    }
    mqttConnected.value = false
    closeSocket()
    stopHeartbeat()
    stopHttpPoll()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }

  function onVisibilityChange() {
    if (disposed || document.visibilityState !== 'visible') return
    if (publicMode) {
      void pollPublicGateway()
      return
    }
    connectMqtt()
  }

  function onOnline() {
    if (disposed) return
    if (publicMode) {
      void pollPublicGateway()
      return
    }
    if (reconnectTimer) clearTimeout(reconnectTimer)
    closeSocket()
    commandConnected.value = false
    mqttConnected.value = false
    stopHeartbeat()
    reconnectTimer = setTimeout(connectMqtt, 500)
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
  }

  return {
    state,
    mqttConnected,
    commandConnected,
    haMqttConnected: { value: null },
    appConfig: { value: null },
    connectMqtt,
    send,
    ensureNotificationPermission: async () => {},
    cleanup,
  }
}
