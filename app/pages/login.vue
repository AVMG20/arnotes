<script setup lang="ts">
definePageMeta({ middleware: [] }) // skip auth middleware on this page

const { signIn, isPending } = useAuth()
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-zinc-950">
    <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-sm space-y-6 shadow-xl">
      <div class="text-center space-y-2">
        <img src="/logo.png" alt="Notes" class="h-10 w-auto mx-auto" />
        <h1 class="text-xl font-semibold text-white">Sign in to Notes</h1>
        <p class="text-sm text-zinc-400">Continue with your Discord account</p>
      </div>

      <UButton
        block
        size="lg"
        color="primary"
        :loading="isPending"
        class="gap-2"
        @click="signIn"
      >
        <UIcon name="i-simple-icons-discord" class="size-5" />
        Continue with Discord
      </UButton>
    </div>
  </div>
</template>
