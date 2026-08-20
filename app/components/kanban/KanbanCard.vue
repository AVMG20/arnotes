<script setup lang="ts">
import { tagChipClass } from '~/utils/tagColors'

const props = defineProps<{
  task: {
    id: string
    title: string
    description: string
    tags: string[]
  }
  commentCount?: number
}>()

defineEmits<{ open: [taskId: string] }>()

// Cards stay quiet: one line of plain text from the description, never rendered
// HTML. The formatted version lives in the task panel.
const snippet = computed(() => {
  if (!props.task.description) return ''
  return props.task.description
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
})
</script>

<template>
  <div
    :data-id="task.id"
    class="group cursor-pointer rounded-lg border border-default bg-default px-3 py-2.5 transition-all hover:border-primary/40 hover:shadow-sm"
    @click="$emit('open', task.id)"
  >
    <p class="line-clamp-2 text-sm font-medium leading-snug text-default">
      {{ task.title }}
    </p>

    <p
      v-if="snippet"
      class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted"
    >
      {{ snippet }}
    </p>

    <div
      v-if="task.tags.length || commentCount"
      class="mt-2 flex items-center gap-1.5"
    >
      <span
        v-for="tag in task.tags.slice(0, 3)"
        :key="tag"
        class="truncate rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset"
        :class="tagChipClass(tag)"
      >
        {{ tag }}
      </span>
      <span
        v-if="task.tags.length > 3"
        class="text-[0.6875rem] text-dimmed"
      >
        +{{ task.tags.length - 3 }}
      </span>

      <span
        v-if="commentCount"
        class="ml-auto flex shrink-0 items-center gap-1 text-[0.6875rem] text-dimmed"
      >
        <UIcon
          name="i-lucide-message-square"
          class="size-3"
        />
        {{ commentCount }}
      </span>
    </div>
  </div>
</template>
