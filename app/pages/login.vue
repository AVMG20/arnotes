<script setup lang="ts">
definePageMeta({ middleware: [] }) // skip auth middleware on this page

useSeoMeta({ title: 'Sign in' })

const config = useRuntimeConfig()
const { signInWithDiscord, signInWithGitHub } = useAuth()
const isDiscordEnabled = computed(() => String(config.public.discordEnabled) === 'true')
const isGitHubEnabled = computed(() => String(config.public.githubEnabled) === 'true')
const isSignUpAllowed = computed(() => String(config.public.allowSignUp) === 'true')
const mode = ref<'sign-in' | 'sign-up'>('sign-in')
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const isPending = ref(false)

async function submit() {
  error.value = ''
  isPending.value = true

  const result = mode.value === 'sign-up'
    ? await authClient.signUp.email({ name: name.value, email: email.value, password: password.value })
    : await authClient.signIn.email({ email: email.value, password: password.value })

  isPending.value = false
  if (result.error) {
    error.value = result.error.message || 'Authentication failed'
    return
  }

  await navigateTo('/note')
}

function switchMode() {
  mode.value = mode.value === 'sign-in' ? 'sign-up' : 'sign-in'
  error.value = ''
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-zinc-950">
    <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-sm space-y-6 shadow-xl">
      <div class="text-center space-y-2">
        <AppLogo class="text-2xl mx-auto block" />
        <h1 class="text-xl font-semibold text-white">
          {{ mode === 'sign-in' ? 'Sign in to Notes' : 'Create your account' }}
        </h1>
        <p class="text-sm text-zinc-400">
          Your notes stay on this server.
        </p>
      </div>

      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UFormField
          v-if="mode === 'sign-up'"
          label="Name"
          required
        >
          <UInput
            v-model="name"
            autocomplete="name"
            class="w-full"
            required
          />
        </UFormField>
        <UFormField
          label="Email"
          required
        >
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            class="w-full"
            required
          />
        </UFormField>
        <UFormField
          label="Password"
          hint="At least 8 characters"
          required
        >
          <UInput
            v-model="password"
            type="password"
            :autocomplete="mode === 'sign-up' ? 'new-password' : 'current-password'"
            minlength="8"
            class="w-full"
            required
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :description="error"
        />

        <UButton
          block
          type="submit"
          size="lg"
          color="primary"
          :loading="isPending"
        >
          {{ mode === 'sign-in' ? 'Sign in' : 'Create account' }}
        </UButton>
      </form>

      <div
        v-if="isSignUpAllowed"
        class="text-center text-sm text-zinc-400"
      >
        {{ mode === 'sign-in' ? 'New here?' : 'Already have an account?' }}
        <button
          type="button"
          class="text-emerald-400 hover:text-emerald-300"
          @click="switchMode"
        >
          {{ mode === 'sign-in' ? 'Create an account' : 'Sign in' }}
        </button>
      </div>

      <template v-if="isDiscordEnabled || isGitHubEnabled">
        <div class="flex items-center gap-3 text-xs text-zinc-600">
          <div class="h-px flex-1 bg-zinc-800" />
          or
          <div class="h-px flex-1 bg-zinc-800" />
        </div>
        <UButton
          v-if="isDiscordEnabled"
          block
          size="lg"
          color="neutral"
          variant="outline"
          class="gap-2"
          @click="signInWithDiscord"
        >
          <UIcon
            name="i-simple-icons-discord"
            class="size-5"
          />
          Continue with Discord
        </UButton>
        <UButton
          v-if="isGitHubEnabled"
          block
          size="lg"
          color="neutral"
          variant="outline"
          class="gap-2"
          @click="signInWithGitHub"
        >
          <UIcon
            name="i-simple-icons-github"
            class="size-5"
          />
          Continue with GitHub
        </UButton>
      </template>
    </div>
  </div>
</template>
