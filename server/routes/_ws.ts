// The WebSocket endpoint clients listen on for changes to their workspace.
//
// It carries no requests: everything the browser needs it still fetches over
// HTTP. This socket only says "something in your workspace changed", so a client
// knows when to refetch instead of polling for it.
import { auth } from '../lib/auth'
import { subscribePeer, unsubscribePeer, workspaceTopic } from '../utils/realtime'
import { db } from '../db'
import { member } from '../db/schema'
import { and, eq } from 'drizzle-orm'

const UNAUTHORIZED = 4401

function headersOf(peer: { request?: { headers?: unknown } }): Headers {
  const raw = peer.request?.headers
  if (raw instanceof Headers) return raw
  return new Headers((raw ?? {}) as Record<string, string>)
}

/**
 * The active team, verified the same way the HTTP helpers verify it: a stale
 * `activeOrganizationId` on a session whose membership is gone must not become a
 * subscription to that team's events.
 */
async function activeTeamId(userId: string, sessionTeamId: string | null | undefined): Promise<string | null> {
  if (!sessionTeamId) return null
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, sessionTeamId), eq(member.userId, userId)))
  return membership ? sessionTeamId : null
}

export default defineWebSocketHandler({
  async open(peer) {
    const headers = headersOf(peer)
    const session = await auth.api.getSession({ headers }).catch(() => null)
    if (!session) {
      peer.close(UNAUTHORIZED, 'Unauthorized')
      return
    }

    const teamId = await activeTeamId(session.user.id, session.session?.activeOrganizationId)
    // The tab identifies itself so its own writes are not echoed back to it.
    const clientId = new URL(peer.request?.url ?? 'http://localhost/_ws').searchParams.get('client')

    subscribePeer(peer, workspaceTopic(session.user.id, teamId), clientId)
    peer.send(JSON.stringify({ type: 'ready' }))
  },

  message(peer, message) {
    // Keep-alive only; the socket takes no commands.
    if (message.text() === 'ping') peer.send(JSON.stringify({ type: 'pong' }))
  },

  close(peer) {
    unsubscribePeer(peer)
  },

  error(peer) {
    unsubscribePeer(peer)
  }
})
