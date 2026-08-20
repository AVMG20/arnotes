import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Live updates for the public pages. Same socket as the app's, asked for
// differently: a reader has no session and no workspace, so it names the one
// note or board it was given a link to and the server decides whether that link
// is live. Nothing is sent back — the page refetches when told something moved.
//
// The app's own feed lives in useRealtime: it is a singleton wired to the
// stores, which a signed-out reader has none of.

const RECONNECT_CAP = 30_000
const HEARTBEAT = 30_000
/** The share is off, expired or gone — reconnecting would only be refused again. */
const NOT_SHARED = 4404

export type PublicTarget = { kind: 'note' | 'project', id: string } | null

export function usePublicLive(target: () => PublicTarget, onChange: () => void) {
  const connected = ref(false)

  let socket: WebSocket | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let stopped = false

  function teardown() {
    connected.value = false
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    socket = null
  }

  function close() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    const open = socket
    teardown()
    open?.close()
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    const delay = Math.min(1000 * 2 ** attempt++, RECONNECT_CAP)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect() {
    if (!import.meta.client || stopped || socket) return
    const current = target()
    if (!current) return

    const url = new URL('/_ws', window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('public', `${current.kind}:${current.id}`)

    try {
      socket = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      attempt = 0
      connected.value = true
      // Idle proxies drop a silent socket; a ping keeps it open.
      heartbeat = setInterval(() => socket?.send('ping'), HEARTBEAT)
    }

    socket.onmessage = (raw) => {
      try {
        const message = JSON.parse(raw.data as string) as { type?: string }
        // 'ready' and 'pong' are liveness; anything else names a change to the
        // one thing this page is showing.
        if (message.type && message.type !== 'ready' && message.type !== 'pong') onChange()
      } catch {
        // Not our message shape; nothing to do.
      }
    }

    socket.onclose = (closeEvent) => {
      teardown()
      if (closeEvent.code === NOT_SHARED) {
        stopped = true
        // The link just went dead; let the page find out the same way it would
        // on a reload, by asking for the content again.
        onChange()
        return
      }
      scheduleReconnect()
    }

    socket.onerror = () => socket?.close()
  }

  function onVisible() {
    if (document.visibilityState !== 'visible' || stopped) return
    if (!socket) {
      attempt = 0
      connect()
    }
    // A page that slept through a change comes back stale.
    onChange()
  }

  onMounted(() => {
    connect()
    document.addEventListener('visibilitychange', onVisible)
  })

  // Following the link to another shared page keeps this component mounted.
  watch(() => {
    const current = target()
    return current ? `${current.kind}:${current.id}` : ''
  }, () => {
    close()
    stopped = false
    attempt = 0
    connect()
  })

  onBeforeUnmount(() => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    close()
  })

  return { connected }
}
