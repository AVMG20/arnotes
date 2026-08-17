<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { marked } from 'marked'
import type { ChatMessage } from '~/composables/useAiChat'

// ─── Panel state ─────────────────────────────────────────────

const open = ref(false)
const { messages, thinking, busy, send, stop, clearChat } = useAiChat()
const { openrouterModel } = useUserSettings()
const router = useRouter()

const input = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
  if (open.value) nextTick(() => inputEl.value?.focus())
}

// ─── Click outside closes the panel ──────────────────────────

function onPointerDown(e: PointerEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (panelEl.value?.contains(target)) return
  // Ignore clicks in teleported Nuxt UI overlays (menus, tooltips, pickers).
  if (target.closest('[data-reka-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"]')) return
  open.value = false
}

onMounted(() => window.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown, true))

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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

// ─── Rendering ───────────────────────────────────────────────

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { async: false, gfm: true }) as string
}

const toolIcon: Record<string, string> = {
  search_items: 'i-lucide-search',
  get_item: 'i-lucide-file-text',
  create_task: 'i-lucide-square-check-big',
  create_note: 'i-lucide-notebook-pen',
  update_item: 'i-lucide-pencil-line'
}

const SUGGESTIONS = [
  { icon: 'i-lucide-list-checks', label: 'What\'s on my plate this week?' },
  { icon: 'i-lucide-search', label: 'Find notes about ' },
  { icon: 'i-lucide-square-check-big', label: 'Create a task to ' }
]

const hasContent = computed(() => messages.value.some(m => m.role === 'user' || m.content))

// ─── Auto-scroll ─────────────────────────────────────────────

let pinnedToBottom = true

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  pinnedToBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
}

watch(messages, async () => {
  if (!pinnedToBottom) return
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}, { deep: true })

watch(open, async (v) => {
  if (v) {
    pinnedToBottom = true
    await nextTick()
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
})

function openTarget(m: ChatMessage) {
  if (!m.targetId) return
  router.push(m.targetKind === 'task' ? `/tasks?id=${m.targetId}` : `/note/${m.targetId}`)
  open.value = false
}
</script>

<template>
  <!-- Floating launcher -->
  <button
    v-if="!open"
    class="group fixed bottom-6 right-6 z-40 flex size-13 items-center justify-center rounded-full bg-primary text-inverted shadow-lg shadow-primary/25 transition-all hover:scale-105 hover:shadow-xl hover:shadow-primary/30 active:scale-95 max-lg:bottom-20 cursor-pointer"
    aria-label="Open Arnai chat"
    @click="toggle"
  >
    <UIcon
      name="i-lucide-sparkles"
      class="size-6"
    />
  </button>

  <!-- Chat panel -->
  <div
    v-else
    ref="panelEl"
    class="fixed bottom-6 right-6 z-50 flex max-h-[calc(100vh-3rem)] w-[420px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-default bg-default shadow-2xl max-lg:bottom-20"
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
        <p class="text-sm font-semibold text-default leading-tight">
          Arnai
        </p>
        <p class="truncate text-xs text-muted leading-tight">
          {{ openrouterModel }}
        </p>
      </div>

      <label class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-default">
        <UIcon
          name="i-lucide-brain"
          class="size-4"
          :class="thinking ? 'text-primary' : ''"
        />
        <span>Thinking</span>
        <USwitch
          :model-value="thinking"
          size="xs"
          @update:model-value="thinking = $event"
        />
      </label>

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
          Search your notes &amp; tasks, or paste Asana tasks and I'll create them for you.
        </p>
        <div class="mt-4 w-full space-y-1.5">
          <button
            v-for="s in SUGGESTIONS"
            :key="s.label"
            class="flex w-full items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2.5 text-left text-xs text-default transition-colors hover:bg-elevated cursor-pointer"
            @click="input = s.label; inputEl?.focus()"
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
          <div class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-inverted whitespace-pre-wrap break-words">
            {{ m.content }}
          </div>
        </div>

        <!-- Tool activity -->
        <div
          v-else-if="m.role === 'tool'"
          class="flex"
        >
          <button
            class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-default bg-elevated/50 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-default"
            :class="m.targetId ? 'cursor-pointer' : 'cursor-default'"
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
            v-html="renderMarkdown(m.content)"
          />

          <div
            v-if="m.pending && !m.content && !m.reasoning"
            class="flex items-center gap-1.5 text-xs text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-3.5 animate-spin"
            />
            Thinking…
          </div>
        </div>
      </template>
    </div>

    <!-- Composer -->
    <div class="shrink-0 border-t border-default p-3">
      <div class="flex items-end gap-2 rounded-xl border border-default bg-elevated/40 px-3 py-2 transition-colors focus-within:border-primary/60">
        <textarea
          ref="inputEl"
          v-model="input"
          rows="1"
          placeholder="Ask about your tasks & notes…"
          class="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm text-default outline-none placeholder:text-muted"
          @keydown="onKeydown"
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
        Arnai can search, create and edit your tasks &amp; notes.
      </p>
    </div>
  </div>
</template>
