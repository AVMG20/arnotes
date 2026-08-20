import { ref } from 'vue'

// The client half of the live-update feed. The socket carries no data, only the
// news that something in this workspace changed; the stores then refetch the
// slice it names. That keeps the screen honest when a change comes from
// somewhere this tab cannot see — an AI agent over MCP, a teammate, or the same
// user in another tab.

type RealtimeMessage
  = | { type: 'ready' }
    | { type: 'pong' }
    | { type: 'notes' }
    | { type: 'projects' }
    | { type: 'board', projectId: string }

// One id per tab, sent on connect and with every mutating request, so the server
// can leave the tab that caused a change out of the fan-out.
const _clientId = ref('')
const _connected = ref(false)

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let attempt = 0
let stopped = false

// Changes arrive in bursts — a drag writes a task, a board and a project row —
// so refetches are coalesced per slice.
const pending = { notes: false, projects: false, boards: new Set<string>() }
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_DELAY = 250

function clientId(): string {
  if (!_clientId.value) {
    _clientId.value = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  }
  return _clientId.value
}

/** Header that marks a request as this tab's own work. */
export function realtimeHeaders(): Record<string, string> {
  return import.meta.client ? { 'x-client-id': clientId() } : {}
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flush, FLUSH_DELAY)
}

async function flush() {
  flushTimer = null
  const { notes, projects } = pending
  const boards = [...pending.boards]
  pending.notes = false
  pending.projects = false
  pending.boards.clear()

  const { syncNotes } = useNotes()
  const { syncProjects, reloadBoardQuiet, activeProjectId, commentsTaskId, loadComments } = useProjects()

  const work: Promise<unknown>[] = []
  if (notes) work.push(syncNotes())

  // Either kind of board news moves the sidebar's task counts and "edited" line.
  if (projects || boards.length) work.push(syncProjects())

  // Only the board on screen is worth fetching; the others are read on open. A
  // list change can also mean the open board was renamed or deleted elsewhere.
  const reload = new Set(boards.filter(projectId => projectId === activeProjectId.value))
  if (projects && activeProjectId.value) reload.add(activeProjectId.value)
  for (const projectId of reload) work.push(reloadBoardQuiet(projectId))

  // An update posted on the task whose panel is open should land in the thread
  // the user is reading, not wait for them to close and reopen it.
  if (commentsTaskId.value && reload.size) work.push(loadComments(commentsTaskId.value))

  await Promise.allSettled(work)
}

function handle(message: RealtimeMessage) {
  switch (message.type) {
    case 'notes':
      pending.notes = true
      break
    case 'projects':
      pending.projects = true
      break
    case 'board':
      pending.boards.add(message.projectId)
      break
    default:
      // 'ready' and 'pong' are liveness only.
      return
  }
  scheduleFlush()
}

function connect() {
  if (!import.meta.client || stopped || socket) return

  const url = new URL('/_ws', window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('client', clientId())

  try {
    socket = new WebSocket(url)
  } catch {
    scheduleReconnect()
    return
  }

  socket.onopen = () => {
    attempt = 0
    _connected.value = true
    // Idle proxies drop a silent socket; a ping every 30s keeps it open.
    heartbeat = setInterval(() => socket?.send('ping'), 30_000)
  }

  socket.onmessage = (raw) => {
    try {
      handle(JSON.parse(raw.data as string) as RealtimeMessage)
    } catch {
      // Not our message shape; nothing to do.
    }
  }

  socket.onclose = (closeEvent) => {
    teardown()
    // 4401 means the session is gone: reconnecting would only fail again.
    if (closeEvent.code === 4401) {
      stopped = true
      return
    }
    scheduleReconnect()
  }

  socket.onerror = () => socket?.close()
}

function teardown() {
  _connected.value = false
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  socket = null
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return
  // 1s, 2s, 4s … capped at 30s, so a restarted server is picked up quickly
  // without hammering one that is down.
  const delay = Math.min(1000 * 2 ** attempt++, 30_000)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

export function useRealtime() {
  function start() {
    stopped = false
    connect()

    // A tab that slept through a change comes back with stale data, so waking up
    // reconnects and resyncs.
    document.addEventListener('visibilitychange', onVisible)
  }

  function onVisible() {
    if (document.visibilityState !== 'visible') return
    if (!socket) {
      attempt = 0
      connect()
    }
    pending.notes = true
    pending.projects = true
    scheduleFlush()
  }

  function stop() {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    teardown()
  }

  return { connected: _connected, clientId: _clientId, start, stop }
}
