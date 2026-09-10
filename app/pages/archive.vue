<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

// Archive: one chat window and nothing else. No note list, no filing, no
// previous conversations — the assistant owns what is stored and the user just
// talks to it. Everything configurable lives in Settings → AI, so this page
// stays a chat window.
definePageMeta({ layout: 'app' })
useHead({ title: 'Archive' })

const {
  messages, busy, ready, loadingMore, hasMore,
  load, loadMore, send, stop, clear
} = useArchive()
const { openrouterApiKey, openrouterApiKeyMasked } = useUserSettings()
const { sidebarOpen } = useSidebar()
const toast = useToast()

const draft = ref('')
const composer = ref<{ focus: () => void } | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const clearing = ref(false)

const hasApiKey = computed(() => !!openrouterApiKey.value || !!openrouterApiKeyMasked.value)
const isEmpty = computed(() => ready.value && messages.value.length === 0)

const SUGGESTIONS = [
  'Remember that I want to build Archive: a chat window that manages its own memory.',
  'What do you know about me so far?',
  'What is still open on my plate?'
]

onMounted(async () => {
  await load()
  await nextTick()
  scrollToBottom('auto')
  composer.value?.focus()
})

function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
  const el = scrollEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior })
}

// Follow the reply as it streams, but only while the user is already at the
// bottom — yanking the view down while they are reading further up is worse
// than letting the new text arrive off-screen.
const NEAR_BOTTOM = 120
const pinned = ref(true)

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
}

watch(() => messages.value.map(m => m.content).join('|'), async () => {
  if (!pinned.value) return
  await nextTick()
  scrollToBottom(busy.value ? 'auto' : 'smooth')
})

async function submit() {
  const text = draft.value.trim()
  if (!text || busy.value) return
  if (!hasApiKey.value) {
    toast.add({ title: 'Add an OpenRouter key in Settings → AI first', color: 'warning' })
    return
  }
  draft.value = ''
  pinned.value = true
  await send(text)
}

function useSuggestion(text: string) {
  draft.value = text
  nextTick(() => composer.value?.focus())
}

async function loadOlder() {
  const el = scrollEl.value
  const before = el?.scrollHeight ?? 0
  await loadMore()
  await nextTick()
  // Keep the message the user was reading where it was, rather than letting the
  // prepended page shove it down the screen.
  if (el) el.scrollTop = el.scrollHeight - before
}

async function clearConversation() {
  clearing.value = true
  try {
    await clear()
    toast.add({ title: 'Conversation cleared. Your memories are untouched.' })
  } catch {
    toast.add({ title: 'Could not clear the conversation', color: 'error' })
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden bg-default">
    <header class="flex shrink-0 items-center gap-2 border-b border-default px-4 py-3">
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        size="sm"
        class="lg:hidden"
        aria-label="Open sidebar"
        @click="sidebarOpen = true"
      />
      <UIcon
        name="i-lucide-archive"
        class="size-5 shrink-0 text-primary"
      />
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-sm font-semibold text-default">
          Archive
        </h1>
        <p class="truncate text-xs text-dimmed">
          Everything you tell it is stored and managed for you
        </p>
      </div>
      <UButton
        v-if="messages.length"
        icon="i-lucide-eraser"
        size="sm"
        color="neutral"
        variant="ghost"
        :loading="clearing"
        aria-label="Clear conversation"
        @click="clearConversation"
      />
    </header>

    <div
      ref="scrollEl"
      class="min-h-0 flex-1 overflow-y-auto"
      @scroll.passive="onScroll"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        <div
          v-if="hasMore"
          class="flex justify-center"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            :loading="loadingMore"
            @click="loadOlder"
          >
            Load older messages
          </UButton>
        </div>

        <div
          v-if="isEmpty"
          class="flex flex-col items-center gap-4 py-16 text-center"
        >
          <UIcon
            name="i-lucide-archive"
            class="size-10 text-dimmed"
          />
          <div>
            <p class="text-sm font-medium text-default">
              Nothing stored yet
            </p>
            <p class="mx-auto mt-1 max-w-md text-sm text-muted">
              Tell Archive anything worth keeping. It decides where it goes, keeps it
              current, and turns plans into todos on its own.
            </p>
          </div>
          <div class="flex flex-col items-stretch gap-2">
            <UButton
              v-for="suggestion in SUGGESTIONS"
              :key="suggestion"
              color="neutral"
              variant="soft"
              size="sm"
              class="text-left"
              @click="useSuggestion(suggestion)"
            >
              {{ suggestion }}
            </UButton>
          </div>
        </div>

        <ArchiveMessage
          v-for="message in messages"
          :key="message.id"
          :message="message"
        />
      </div>
    </div>

    <footer class="shrink-0 border-t border-default px-4 py-3">
      <div class="mx-auto w-full max-w-3xl">
        <UAlert
          v-if="!hasApiKey"
          class="mb-3"
          color="warning"
          variant="soft"
          icon="i-lucide-key-round"
          title="Archive needs an OpenRouter key"
          description="Add one in Settings → AI to start."
        />

        <div class="flex items-end gap-2 rounded-xl border border-default bg-elevated/40 px-3 py-2.5">
          <ArchiveComposer
            ref="composer"
            v-model="draft"
            :disabled="busy"
            @submit="submit"
          />
          <UButton
            v-if="busy"
            icon="i-lucide-square"
            size="sm"
            color="neutral"
            variant="soft"
            aria-label="Stop"
            @click="stop"
          />
          <UButton
            v-else
            icon="i-lucide-arrow-up"
            size="sm"
            color="primary"
            :disabled="!draft.trim()"
            aria-label="Send"
            @click="submit"
          />
        </div>
        <p class="mt-1.5 text-center text-xs text-dimmed">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </footer>
  </div>
</template>
