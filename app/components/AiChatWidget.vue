<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ChatMessage } from '~/composables/useAiChat'
import { renderChatMarkdown } from '~/utils/markdown'

// ─── Panel state ─────────────────────────────────────────────

const open = ref(false)
const expanded = useCookie<boolean>('arnai-expanded', { default: () => false, maxAge: 60 * 60 * 24 * 365 })

const { messages, thinking, busy, send, retry, stop, clearChat } = useAiChat()
const { openrouterModel, openrouterApiKey, openrouterApiKeyMasked } = useUserSettings()
const router = useRouter()

const input = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)

const hasApiKey = computed(() => !!openrouterApiKey.value || !!openrouterApiKeyMasked.value)

function toggle() {
  open.value = !open.value
  if (open.value) nextTick(() => inputEl.value?.focus())
}

// Escape closes the panel, unless a menu or dialog on top of it owns the key.
// Clicking elsewhere in the app deliberately does *not* close it: the chat is a
// side panel you work alongside, not a modal.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  if (document.querySelector('[data-reka-popper-content-wrapper], [role="dialog"], [role="menu"]')) return
  open.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// ─── Sending ─────────────────────────────────────────────────

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

async function submit() {
  const text = input.value.trim()
  if (!text || busy.value) return
  input.value = ''
  nextTick(autoGrow)
  await send(text)
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function useSuggestion(text: string) {
  input.value = text
  nextTick(() => {
    inputEl.value?.focus()
    autoGrow()
  })
}

// ─── Rendering ───────────────────────────────────────────────

const toolIcon: Record<string, string> = {
  search_notes: 'i-lucide-search',
  get_note: 'i-lucide-file-text',
  create_note: 'i-lucide-notebook-pen',
  update_note: 'i-lucide-pencil-line',
  delete_note: 'i-lucide-trash-2'
}

const toolVerb: Record<string, string> = {
  search_notes: 'Searching notes',
  get_note: 'Reading a note',
  create_note: 'Writing a new note',
  update_note: 'Rewriting a note',
  delete_note: 'Moving a note to trash'
}

// While the model writes a long tool argument (a whole note body) no text
// streams in, so say what it is doing instead of showing a bare spinner.
function pendingLabel(m: ChatMessage): string {
  if (m.retrying) return 'Connection lost — reconnecting…'
  const call = m.toolProgress?.[m.toolProgress.length - 1]
  if (call?.name) return `${toolVerb[call.name] ?? call.name}…`
  return 'Thinking…'
}

const SUGGESTIONS = [
  { icon: 'i-lucide-search', label: 'Find notes about ' },
  { icon: 'i-lucide-notebook-pen', label: 'Write a note about ' },
  { icon: 'i-lucide-list-checks', label: 'Summarize my notes tagged ' }
]

const hasContent = computed(() => messages.value.some(m => m.role === 'user' || m.content))
const lastMessage = computed(() => messages.value[messages.value.length - 1])
const canRetry = computed(() => !busy.value && !!lastMessage.value?.error)

// ─── Auto-scroll ─────────────────────────────────────────────

const pinnedToBottom = ref(true)

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  pinnedToBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
}

async function scrollToBottom() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
  pinnedToBottom.value = true
}

watch(messages, () => {
  if (pinnedToBottom.value) scrollToBottom()
}, { deep: true })

watch([open, expanded], ([isOpen]) => {
  if (isOpen) scrollToBottom()
})

function openTarget(m: ChatMessage) {
  if (!m.targetId) return
  router.push(`/note/${m.targetId}`)
  if (window.innerWidth < 640) open.value = false
}
</script>

<template>
  <!-- Floating launcher -->
  <button
    v-if="!open"
    class="fixed bottom-6 right-6 z-60 flex size-13 cursor-pointer items-center justify-center rounded-full bg-primary text-inverted shadow-lg shadow-primary/25 transition-all hover:scale-105 hover:shadow-xl hover:shadow-primary/30 active:scale-95 max-lg:bottom-20"
    aria-label="Open Arnai chat"
    @click="toggle"
  >
    <UIcon
      name="i-lucide-sparkles"
      class="size-6"
    />
  </button>

  <!-- Chat panel: bottom sheet on phones, floating card from `sm` up -->
  <div
    v-else
    class="fixed z-60 flex flex-col overflow-hidden border border-default bg-default shadow-2xl
           inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl
           sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-h-[calc(100dvh-3rem)] sm:rounded-xl max-lg:sm:bottom-20"
    :class="expanded ? 'sm:w-[760px] sm:h-[calc(100dvh-6rem)]' : 'sm:w-[420px]'"
    style="max-width: 100vw"
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center gap-2.5 border-b border-default px-4 py-3">
      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <UIcon
          name="i-lucide-sparkles"
          class="size-4.5"
        />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold leading-tight text-default">
          Arnai
        </p>
        <p class="truncate text-xs leading-tight text-muted">
          {{ openrouterModel }}
        </p>
      </div>

      <UTooltip text="Show the model's reasoning">
        <label class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-default">
          <UIcon
            name="i-lucide-brain"
            class="size-4"
            :class="thinking ? 'text-primary' : ''"
          />
          <span class="max-sm:sr-only">Thinking</span>
          <USwitch
            v-model="thinking"
            size="xs"
          />
        </label>
      </UTooltip>

      <UButton
        :icon="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        color="neutral"
        variant="ghost"
        size="xs"
        class="max-sm:hidden"
        :aria-label="expanded ? 'Shrink chat' : 'Expand chat'"
        @click="expanded = !expanded"
      />
      <UButton
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="New chat"
        @click="clearChat"
      />
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="Close chat"
        @click="open = false"
      />
    </div>

    <!-- Messages -->
    <div
      ref="scrollEl"
      class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      @scroll="onScroll"
    >
      <!-- Empty state -->
      <div
        v-if="!hasContent && !busy"
        class="flex h-full flex-col items-center justify-center gap-1 px-4 text-center"
      >
        <div class="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <UIcon
            name="i-lucide-sparkles"
            class="size-6"
          />
        </div>
        <p class="text-sm font-medium text-default">
          Hi, I'm Arnai
        </p>
        <p class="text-xs text-muted">
          Search your notes, or paste something in and I'll turn it into a note for you.
        </p>

        <div
          v-if="!hasApiKey"
          class="mt-4 w-full rounded-lg border border-default bg-elevated/40 p-3 text-left"
        >
          <p class="text-xs text-default">
            No OpenRouter API key yet — add one to start chatting.
          </p>
          <UButton
            label="Open AI settings"
            icon="i-lucide-key-round"
            size="xs"
            color="primary"
            variant="soft"
            class="mt-2"
            to="/settings"
            @click="open = false"
          />
        </div>

        <div
          v-else
          class="mt-4 w-full space-y-1.5"
        >
          <button
            v-for="s in SUGGESTIONS"
            :key="s.label"
            class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2.5 text-left text-xs text-default transition-colors hover:bg-elevated"
            @click="useSuggestion(s.label)"
          >
            <UIcon
              :name="s.icon"
              class="size-4 shrink-0 text-primary"
            />
            {{ s.label }}
          </button>
        </div>
      </div>

      <template
        v-for="m in messages"
        :key="m.id"
      >
        <!-- User -->
        <div
          v-if="m.role === 'user'"
          class="flex justify-end"
        >
          <div class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-inverted">
            {{ m.content }}
          </div>
        </div>

        <!-- Tool activity -->
        <div
          v-else-if="m.role === 'tool'"
          class="flex"
        >
          <button
            class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-default bg-elevated/50 px-2.5 py-1 text-xs transition-colors hover:bg-elevated"
            :class="[
              m.targetId ? 'cursor-pointer hover:text-default' : 'cursor-default',
              m.error ? 'text-error' : 'text-muted'
            ]"
            @click="openTarget(m)"
          >
            <UIcon
              :name="m.pending ? 'i-lucide-loader-circle' : (toolIcon[m.name ?? ''] ?? 'i-lucide-wrench')"
              class="size-3.5 shrink-0"
              :class="{ 'animate-spin': m.pending }"
            />
            <span class="truncate">{{ m.label ?? m.name }}</span>
            <UIcon
              v-if="m.targetId"
              name="i-lucide-arrow-up-right"
              class="size-3 shrink-0 opacity-50"
            />
          </button>
        </div>

        <!-- Assistant -->
        <div
          v-else
          class="space-y-2"
        >
          <!-- Reasoning (thinking models) -->
          <details
            v-if="m.reasoning?.trim()"
            class="group rounded-lg border border-default bg-elevated/30"
          >
            <summary class="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-xs text-muted">
              <UIcon
                name="i-lucide-brain"
                class="size-3.5"
                :class="m.pending ? 'animate-pulse text-primary' : ''"
              />
              Thinking
            </summary>
            <div class="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 pb-2 text-xs leading-relaxed text-muted">
              {{ m.reasoning }}
            </div>
          </details>

          <div
            v-if="m.content"
            class="markdown-content max-w-full text-sm leading-relaxed text-default"
            :class="m.error ? 'text-error' : ''"
            v-html="renderChatMarkdown(m.content)"
          />

          <div
            v-if="m.pending && (m.retrying || m.toolProgress?.length || (!m.content && !m.reasoning))"
            class="flex items-center gap-1.5 text-xs"
            :class="m.retrying ? 'text-warning' : 'text-muted'"
          >
            <UIcon
              :name="m.retrying ? 'i-lucide-wifi-off' : 'i-lucide-loader-circle'"
              class="size-3.5"
              :class="{ 'animate-spin': !m.retrying }"
            />
            {{ pendingLabel(m) }}
          </div>
        </div>
      </template>

      <div
        v-if="canRetry"
        class="flex"
      >
        <UButton
          label="Retry"
          icon="i-lucide-rotate-cw"
          size="xs"
          color="neutral"
          variant="outline"
          @click="retry"
        />
      </div>
    </div>

    <!-- Jump to latest -->
    <button
      v-if="!pinnedToBottom && hasContent"
      class="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border border-default bg-default px-2.5 py-1 text-xs text-muted shadow-md transition-colors hover:text-default"
      @click="scrollToBottom"
    >
      <UIcon
        name="i-lucide-arrow-down"
        class="size-3.5"
      />
      Latest
    </button>

    <!-- Composer -->
    <div
      class="shrink-0 border-t border-default p-3"
      style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom))"
    >
      <div class="flex items-end gap-2 rounded-xl border border-default bg-elevated/40 px-3 py-2 transition-colors focus-within:border-primary/60">
        <textarea
          ref="inputEl"
          v-model="input"
          rows="1"
          placeholder="Ask about your notes…"
          aria-label="Message Arnai"
          class="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-default outline-none placeholder:text-muted"
          @keydown="onInputKeydown"
          @input="autoGrow"
        />
        <UButton
          v-if="busy"
          icon="i-lucide-square"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Stop generating"
          @click="stop"
        />
        <UButton
          v-else
          icon="i-lucide-arrow-up"
          size="xs"
          :disabled="!input.trim()"
          aria-label="Send message"
          @click="submit"
        />
      </div>
      <p class="mt-1.5 px-1 text-[10px] text-muted">
        Arnai can search, create and edit your notes.
      </p>
    </div>
  </div>
</template>
