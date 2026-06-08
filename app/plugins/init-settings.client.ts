import { authClient } from '~/composables/useAuth'
import { loadUserSettings } from '~/composables/useUserSettings'

export default defineNuxtPlugin(async () => {
  const sessionState = authClient.useSession()
  const session = sessionState.value.isPending
    ? (await authClient.getSession()).data
    : sessionState.value.data
  if (!session) return

  await loadUserSettings()
})
