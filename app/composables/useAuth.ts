import { createAuthClient } from 'better-auth/vue'
import { organizationClient } from 'better-auth/client/plugins'

const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  plugins: [
    organizationClient()
  ]
})

export function useAuth() {
  const sessionRef = authClient.useSession()

  const session = computed(() => sessionRef.value.data)
  const isPending = computed(() => sessionRef.value.isPending)

  async function signInWithDiscord() {
    await authClient.signIn.social({ provider: 'discord', callbackURL: '/note' })
  }

  async function signInWithGitHub() {
    await authClient.signIn.social({ provider: 'github', callbackURL: '/note' })
  }

  async function signOut() {
    await authClient.signOut()
    window.location.href = '/login'
  }

  return {
    session,
    isPending,
    signInWithDiscord,
    signInWithGitHub,
    signOut
  }
}

export { authClient }
