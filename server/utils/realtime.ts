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
 */
export type RealtimeEvent
  = | { type: 'notes' }
    | { type: 'projects' }
    | { type: 'board', projectId: string }

/**
 * Events are addressed to a workspace, never to a user: everyone looking at a
 * team's boards needs the same signal, and a personal workspace is just a
 * workspace of one.
 */
export function workspaceTopic(userId: string, teamId: string | null): string {
  return teamId ? `team:${teamId}` : `user:${userId}`
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

/** Sends an event to every client in a workspace except the one that caused it. */
export function publish(topic: string, event: RealtimeEvent, originClientId?: string | null) {
  if (!subscriptions.size) return
  const payload = JSON.stringify(event)

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
