<script setup lang="ts">
import { tagChipClass } from '~/utils/tagColors'
import { formatDateMention } from '~/composables/useDateMention'
import { relativeTime } from '~/composables/useRelativeTime'
import { checklistProgress, taskDueDate, deletionSourceLabel } from '#shared/utils/board'

const props = defineProps<{
  task: {
    id: string
    title: string
    description: string
    tags: string[]
    deletedAt?: number | null
    deletedVia?: 'ui' | 'mcp' | 'ai' | null
  }
  commentCount?: number
}>()

defineEmits<{ open: [taskId: string], restore: [taskId: string], purge: [taskId: string] }>()

// A card in the board's trash is drawn in place, faded, so it is obvious both
// that it is gone and where it used to sit. It is not a link into the task
// panel: there is nothing to edit until it is back.
const trashed = computed(() => props.task.deletedAt != null)

const trashedLabel = computed(() => {
  if (!props.task.deletedAt) return ''
  return `Deleted ${relativeTime(props.task.deletedAt)}${deletionSourceLabel(props.task.deletedVia)}`
})

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

// Both of these are read out of the description rather than stored: a checklist
// is the editor's task list, a due date is an `@date` mention. Nothing to fill
// in, and nothing that can fall out of step with what the task actually says.
const checklist = computed(() => checklistProgress(props.task.description))
const checklistDone = computed(() => !!checklist.value && checklist.value.done === checklist.value.total)

const due = computed(() => taskDueDate(props.task.description))
const dueLabel = computed(() => due.value === null ? '' : formatDateMention(new Date(due.value).toISOString()))
const overdue = computed(() => due.value !== null && due.value < Date.now())

// One row of small print under the card, or none at all.
const hasMeta = computed(() =>
  props.task.tags.length > 0 || !!checklist.value || due.value !== null || !!props.commentCount
)
</script>

<template>
  <div
    :data-id="task.id"
    :data-card-id="trashed ? undefined : task.id"
    :role="trashed ? undefined : 'button'"
    :tabindex="trashed ? undefined : 0"
    class="group rounded-lg border bg-default px-3 py-2.5 transition-all"
    :class="trashed
      ? 'border-dashed border-default opacity-50 hover:opacity-100'
      : 'cursor-pointer border-default hover:border-primary/40 hover:shadow-sm focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30'"
    @click="trashed || $emit('open', task.id)"
    @keydown.enter.prevent="trashed || $emit('open', task.id)"
    @keydown.space.prevent="trashed || $emit('open', task.id)"
  >
    <p
      class="line-clamp-2 text-sm font-medium leading-snug"
      :class="trashed ? 'text-muted line-through decoration-1' : 'text-default'"
    >
      {{ task.title }}
    </p>

    <p
      v-if="snippet"
      class="mt-1 line-clamp-2 text-xs leading-relaxed text-muted"
    >
      {{ snippet }}
    </p>

    <!-- Labels carry the colour on a card; everything else stays small print so
         the row reads as one quiet line however much of it is filled in. -->
    <div
      v-if="hasMeta"
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

      <span class="ml-auto flex shrink-0 items-center gap-2 text-[0.6875rem] text-dimmed">
        <span
          v-if="due !== null"
          class="flex items-center gap-1"
          :class="overdue ? 'font-medium text-error' : ''"
        >
          <UIcon
            name="i-lucide-calendar"
            class="size-3"
          />
          {{ dueLabel }}
        </span>

        <span
          v-if="checklist"
          class="flex items-center gap-1 tabular-nums"
          :class="checklistDone ? 'text-success' : ''"
        >
          <UIcon
            name="i-lucide-list-checks"
            class="size-3"
          />
          {{ checklist.done }}/{{ checklist.total }}
        </span>

        <span
          v-if="commentCount"
          class="flex items-center gap-1"
        >
          <UIcon
            name="i-lucide-message-square"
            class="size-3"
          />
          {{ commentCount }}
        </span>
      </span>
    </div>

    <div
      v-if="trashed"
      class="mt-2 border-t border-default pt-2"
    >
      <p class="truncate text-[0.6875rem] text-dimmed">
        {{ trashedLabel }}
      </p>
      <div class="mt-1 flex items-center gap-1">
        <UButton
          label="Restore"
          icon="i-lucide-undo-2"
          size="xs"
          color="neutral"
          variant="soft"
          @click.stop="$emit('restore', task.id)"
        />
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          aria-label="Delete permanently"
          title="Delete permanently"
          @click.stop="$emit('purge', task.id)"
        />
      </div>
    </div>
  </div>
</template>
