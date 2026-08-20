import { authClient } from '~/composables/useAuth'

// Opens the live-update socket for a signed-in user. The stores are already
// seeded by init-notes.client.ts by the time this runs, so the first event has
// something to refresh.
export default defineNuxtPlugin(async () => {
  const { data: session } = await authClient.getSession()
  if (!session) return

  useRealtime().start()
})
