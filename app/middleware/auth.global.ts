import { authClient } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  if (to.path.startsWith('/public/')) return

  const sessionState = authClient.useSession()
  const session = sessionState.value.isPending
    ? (await authClient.getSession()).data
    : sessionState.value.data
  if (!session) return navigateTo('/login')
})
