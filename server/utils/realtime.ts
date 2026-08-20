// Live updates. A workspace's data can change without the browser doing
// anything — an AI agent writing over MCP, a teammate on another machine, the
// same user in a second tab — so every mutation announces itself here and the
// WebSocket handler fans it out to the other clients in that workspace.
//
// Fan-out is in-process: peers live in this module's map, so a deployment
// running several app instances would need a shared bus (Redis, Postgres
// LISTEN/NOTIFY) between them. One instance, which is how Arnotes ships, needs
// nothing else.
import type { Peer } from 'crossws'
import type { H3Event } from 'h3'
import { getUserActiveTeamId } from './auth-helpers'

/**
 * What changed, at the coarsest useful grain — the client refetches the affected
 * slice rather than trying to apply a patch it was not part of.
 *
 * - `notes`: the note list changed (created, edited, trashed, restored)
 * - `projects`: the set of boards changed (created, renamed, deleted)
 * - `board`: one board's columns, tasks or updates changed
 *
 * The optional ids name the single note or board behind the change. Workspace
 * clients ignore them and refetch the slice; they exist so the change can also
 * reach the anonymous readers of that one shared link.
 */
export type RealtimeEvent
  = | { type: 'notes', noteId?: string }
    | { type: 'projects', projectId?: string }
    | { type: 'board', projectId: string }

/**
 * Events are addressed to a workspace, never to a user: everyone looking at a
 * team's boards needs the same signal, and a personal workspace is just a
 * workspace of one.
 */
export function workspaceTopic(userId: string, teamId: string | null): string {
  return teamId ? `team:${teamId}` : `user:${userId}`
}

/**
 * Topics for the public read-only pages. A shared link is its own audience:
 * the readers are anonymous and belong to no workspace, so they subscribe to
 * the one note or board they were given rather than to a workspace feed.
 */
export function publicNoteTopic(noteId: string): string {
  return `public:note:${noteId}`
}

export function publicProjectTopic(projectId: string): string {
  return `public:project:${projectId}`
}

/** The public topic a workspace event also belongs on, if it names one thing. */
function publicTopicFor(event: RealtimeEvent): string | null {
  if (event.type === 'board') return publicProjectTopic(event.projectId)
  if (event.type === 'projects') return event.projectId ? publicProjectTopic(event.projectId) : null
  return event.noteId ? publicNoteTopic(event.noteId) : null
}

interface Subscription {
  topic: string
  /** The tab that caused a change ignores its own echo. */
  clientId: string | null
}

const subscriptions = new Map<Peer, Subscription>()

export function subscribePeer(peer: Peer, topic: string, clientId: string | null) {
  subscriptions.set(peer, { topic, clientId })
}

export function unsubscribePeer(peer: Peer) {
  subscriptions.delete(peer)
}

export function peerCount(): number {
  return subscriptions.size
}

/**
 * Hangs up on everyone listening to a topic. Called when a share is switched
 * off or its subject is gone: the readers keep no data, but a socket that stays
 * subscribed would go on reporting that something changed on a board nobody
 * gave them access to any more.
 */
export function closeTopic(topic: string, code = 4404, reason = 'Not shared') {
  for (const [peer, subscription] of subscriptions) {
    if (subscription.topic !== topic) continue
    subscriptions.delete(peer)
    try {
      peer.close(code, reason)
    } catch {
      // Already gone; the map entry above was the only thing left to clean up.
    }
  }
}

function fanout(topic: string, payload: string, originClientId?: string | null) {
  for (const [peer, subscription] of subscriptions) {
    if (subscription.topic !== topic) continue
    if (originClientId && subscription.clientId === originClientId) continue
    try {
      peer.send(payload)
    } catch {
      // A peer that died between the change and the fan-out is dropped on close.
    }
  }
}

/**
 * Sends an event to every client in a workspace except the one that caused it,
 * and to anyone reading the shared link of the note or board it names — a
 * public page is a viewer of the same data, just without a session.
 */
export function publish(topic: string, event: RealtimeEvent, originClientId?: string | null) {
  if (!subscriptions.size) return
  const payload = JSON.stringify(event)

  fanout(topic, payload, originClientId)

  const publicTopic = publicTopicFor(event)
  // Readers of a shared link are never the origin of a change, so nothing is
  // excluded here. A board that is not shared simply has no subscribers.
  if (publicTopic) fanout(publicTopic, payload)
}

/**
 * Announces a change made through an authenticated HTTP request. The workspace
 * comes from the session, and the browser's own tab id — sent as `x-client-id`
 * by the mutating composables — is excluded so a tab does not refetch what it
 * just wrote.
 */
export async function publishFromEvent(event: H3Event, realtimeEvent: RealtimeEvent) {
  const session = event.context.session
  if (!session) return
  const topic = workspaceTopic(session.user.id, await getUserActiveTeamId(event))
  publish(topic, realtimeEvent, getRequestHeader(event, 'x-client-id') ?? null)
}
