<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'
import type { ArchiveChatMessage } from '~/composables/useArchive'

// One turn in the transcript. A user turn is a plain bubble; an assistant turn
// is prose with live cards in it, preceded by what it did to get there.
const props = defineProps<{ message: ArchiveChatMessage }>()

const isUser = computed(() => props.message.role === 'user')
const showSpinner = computed(() =>
  props.message.pending && !props.message.content.trim() && !props.message.error
)

const TOOL_ICONS: Record<string, string> = {
  search_memory: 'i-lucide-search',
  recall: 'i-lucide-book-open',
  remember: 'i-lucide-brain',
  revise: 'i-lucide-pencil-line',
  forget: 'i-lucide-trash-2',
  add_todos: 'i-lucide-list-plus',
  update_todos: 'i-lucide-check',
  drop_todos: 'i-lucide-x'
}
</script>

<template>
  <div
    v-if="isUser"
    class="flex justify-end"
  >
    <div
      class="markdown-content max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm text-default"
      v-html="renderChatMarkdown(message.content)"
    />
  </div>

  <div
    v-else
    class="min-w-0"
  >
    <ul
      v-if="message.actions.length"
      class="mb-2 space-y-1"
    >
      <li
        v-for="(action, index) in message.actions"
        :key="index"
        class="flex items-center gap-1.5 text-xs text-dimmed"
      >
        <UIcon
          :name="TOOL_ICONS[action.name] ?? 'i-lucide-wrench'"
          class="size-3.5 shrink-0"
        />
        <span class="truncate">{{ action.label }}</span>
      </li>
    </ul>

    <div
      v-if="showSpinner"
      class="flex items-center gap-2 text-sm text-dimmed"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
      />
      Thinking…
    </div>

    <ArchiveMarkdown
      v-else-if="message.content.trim()"
      :text="message.content"
    />

    <p
      v-if="message.error"
      class="mt-2 text-xs text-error"
    >
      {{ message.error }}
    </p>
  </div>
</template>
