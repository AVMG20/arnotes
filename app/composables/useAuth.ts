import { createAuthClient } from 'better-auth/vue'

const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
})

export function useAuth() {
  const sessionRef = authClient.useSession()

  const session = computed(() => sessionRef.value.data)
  const isPending = computed(() => sessionRef.value.isPending)

  async function signIn() {
    await authClient.signIn.social({ provider: 'discord', callbackURL: '/note' })
  }

  async function signOut() {
    await authClient.signOut()
    window.location.href = '/login'
  }

  return {
    session,
    isPending,
    signIn,
    signOut,
  }
}

export { authClient }
