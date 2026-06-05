import { authClient } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const { data: session } = await authClient.getSession()
  if (!session) return navigateTo('/login')
})
