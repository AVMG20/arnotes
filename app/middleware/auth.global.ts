import { authClient } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  if (to.path.startsWith('/public/')) return

  // The reactive session can still be empty right after signing in, so an
  // absent session is confirmed against the server before bouncing to /login.
  const sessionState = authClient.useSession()
  const session = (!sessionState.value.isPending && sessionState.value.data)
    ? sessionState.value.data
    : (await authClient.getSession()).data
  if (!session) return navigateTo('/login')
})
