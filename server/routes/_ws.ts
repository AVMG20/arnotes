// The WebSocket endpoint clients listen on for changes to their workspace.
//
// It carries no requests: everything the browser needs it still fetches over
// HTTP. This socket only says "something in your workspace changed", so a client
// knows when to refetch instead of polling for it.
//
// A public page connects here too. It has no session, so it asks for the one
// note or board it was given a link to, and gets it only while that link is
// live.
import { auth } from '../lib/auth'
import { subscribePeer, unsubscribePeer, workspaceTopic, publicNoteTopic, publicProjectTopic } from '../utils/realtime'
import { findPublicNote, findPublicProject } from '../utils/publicAccess'
import { db } from '../db'
import { member } from '../db/schema'
import { and, eq } from 'drizzle-orm'

const UNAUTHORIZED = 4401
const NOT_SHARED = 4404

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

/**
 * The topic behind a `?public=note:<id>` / `?public=project:<id>` request, or
 * null when nothing is shared under that id. The share is checked here exactly
 * as the HTTP endpoints check it: a socket must not become a way to watch a
 * board whose link was never handed out.
 */
async function publicTopic(request: string): Promise<string | null> {
  const separator = request.indexOf(':')
  if (separator < 0) return null
  const kind = request.slice(0, separator)
  const id = request.slice(separator + 1)
  if (!id) return null
  if (kind === 'note') return await findPublicNote(id) ? publicNoteTopic(id) : null
  if (kind === 'project') return await findPublicProject(id) ? publicProjectTopic(id) : null
  return null
}

export default defineWebSocketHandler({
  async open(peer) {
    const query = new URL(peer.request?.url ?? 'http://localhost/_ws').searchParams
    // The tab identifies itself so its own writes are not echoed back to it.
    const clientId = query.get('client')

    const shared = query.get('public')
    if (shared) {
      const topic = await publicTopic(shared)
      if (!topic) {
        peer.close(NOT_SHARED, 'Not shared')
        return
      }
      subscribePeer(peer, topic, clientId)
      peer.send(JSON.stringify({ type: 'ready' }))
      return
    }

    const headers = headersOf(peer)
    const session = await auth.api.getSession({ headers }).catch(() => null)
    if (!session) {
      peer.close(UNAUTHORIZED, 'Unauthorized')
      return
    }

    const teamId = await activeTeamId(session.user.id, session.session?.activeOrganizationId)

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
