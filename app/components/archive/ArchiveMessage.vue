<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'
import { TOOL_ICONS, type ArchiveChatMessage } from '~/composables/useArchive'

// One turn in the transcript. A user turn is a plain bubble; an assistant turn
// is prose with live cards in it, preceded by what it did to get there — each
// step showing as it runs, then as what it did once it has run.
const props = defineProps<{ message: ArchiveChatMessage }>()

const isUser = computed(() => props.message.role === 'user')
const hasContent = computed(() => props.message.content.trim().length > 0)
const running = computed(() => props.message.actions.find(action => action.pending))

// Before any text lands, say what is happening rather than showing a bare
// spinner: a tool that writes a whole memory body takes a while to generate.
const waitingLabel = computed(() => running.value?.label ?? 'Thinking…')
const showWaiting = computed(() => props.message.pending && !hasContent.value && !props.message.error)

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div
    v-if="isUser"
    class="group flex flex-col items-end gap-1"
  >
    <div
      class="markdown-content max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm text-default"
      v-html="renderChatMarkdown(message.content)"
    />
    <span class="pr-1 text-[11px] text-dimmed opacity-0 transition-opacity group-hover:opacity-100">
      {{ timeLabel(message.createdAt) }}
    </span>
  </div>

  <div
    v-else
    class="flex min-w-0 gap-3"
  >
    <div
      class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <UIcon
        name="i-lucide-archive"
        class="size-3.5"
      />
    </div>

    <div class="min-w-0 flex-1 space-y-2">
      <!-- The trail of what the assistant did this turn. -->
      <ol
        v-if="message.actions.length"
        class="space-y-0.5 border-l border-default pl-2.5"
      >
        <li
          v-for="(action, index) in message.actions"
          :key="index"
          class="flex items-center gap-1.5 text-xs"
          :class="action.pending ? 'text-muted' : 'text-dimmed'"
        >
          <UIcon
            :name="action.pending ? 'i-lucide-loader-circle' : (TOOL_ICONS[action.name] ?? 'i-lucide-wrench')"
            class="size-3.5 shrink-0"
            :class="action.pending ? 'animate-spin text-primary' : ''"
          />
          <span class="truncate">{{ action.label }}</span>
        </li>
      </ol>

      <div
        v-if="showWaiting"
        class="flex items-center gap-2 text-sm text-dimmed"
      >
        <span class="flex items-center gap-0.5">
          <span class="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-primary/70" />
        </span>
        {{ waitingLabel }}
      </div>

      <ArchiveMarkdown
        v-else-if="hasContent"
        :text="message.content"
        :class="message.pending ? 'archive-streaming' : ''"
      />

      <p
        v-if="message.error"
        class="flex items-center gap-1.5 text-xs text-error"
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="size-3.5 shrink-0"
        />
        {{ message.error }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* A caret at the end of the text still being written. */
.archive-streaming :deep(.markdown-content:last-child > :last-child)::after {
  content: '';
  display: inline-block;
  width: 0.45em;
  height: 1em;
  margin-left: 0.15em;
  vertical-align: text-bottom;
  border-radius: 1px;
  background: var(--ui-primary);
  animation: archive-caret 1s steps(2, start) infinite;
}

@keyframes archive-caret {
  to {
    visibility: hidden;
  }
}
</style>
