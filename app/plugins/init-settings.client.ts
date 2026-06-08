import { authClient } from '~/composables/useAuth'
import { loadUserSettings } from '~/composables/useUserSettings'

export default defineNuxtPlugin(async () => {
  const { data: session } = await authClient.getSession()
  if (!session) return

  await loadUserSettings()
})
