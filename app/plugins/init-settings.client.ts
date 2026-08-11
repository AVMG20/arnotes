import { authClient } from '~/composables/useAuth'
import { loadUserSettings } from '~/composables/useUserSettings'

export default defineNuxtPlugin({
  name: 'user-settings',
  async setup() {
    const sessionState = authClient.useSession()
    const session = sessionState.value.isPending
      ? (await authClient.getSession()).data
      : sessionState.value.data
    if (!session) return

    await loadUserSettings()
  }
})
