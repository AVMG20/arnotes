import { authClient } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/') return
  if (to.path === '/login') return
  if (to.path.startsWith('/public/')) return

  const { data: session } = await authClient.getSession()
  if (!session) return navigateTo('/login')
})
