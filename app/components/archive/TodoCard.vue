<script setup lang="ts">
import { computed, ref } from 'vue'

// The todos a reply is showing. Ticking a box is one UPDATE on one row — which
// is the whole reason todos are a table of their own rather than "- [ ]" lines
// inside a memory body.
const props = defineProps<{ ids: string[] }>()

const { todos, saveTodo, dropTodo, adoptConflict } = useArchive()
const toast = useToast()

const rows = computed(() => props.ids.map(id => ({ id, row: todos.value[id] })))
const known = computed(() => rows.value.filter(entry => entry.row && !entry.row.deletedAt))
const openCount = computed(() => known.value.filter(entry => !entry.row!.done).length)

const editingId = ref<string | null>(null)
const draft = ref('')
const pending = ref(new Set<string>())

function isPending(id: string) {
  return pending.value.has(id)
}

async function run(id: string, work: () => Promise<unknown>, failure: string) {
  pending.value = new Set(pending.value).add(id)
  try {
    await work()
  } catch (error) {
    const conflict = (error as { data?: { data?: { todo?: unknown } } })?.data?.data?.todo
    if (conflict) {
      adoptConflict('todo', conflict as never)
      toast.add({ title: 'That todo had already changed — showing the stored version', color: 'warning' })
    } else {
      toast.add({ title: failure, color: 'error' })
    }
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}

function toggle(id: string, done: boolean) {
  return run(id, () => saveTodo(id, { done }), 'Could not update that todo')
}

function startEditing(id: string, title: string) {
  editingId.value = id
  draft.value = title
}

async function commit(id: string) {
  const title = draft.value.trim()
  const current = todos.value[id]
  editingId.value = null
  if (!title || !current || title === current.title) return
  await run(id, () => saveTodo(id, { title }), 'Could not rename that todo')
}

function remove(id: string) {
  return run(id, () => dropTodo(id), 'Could not remove that todo')
}

function dueLabel(dueAt: number) {
  return new Date(dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function overdue(dueAt: number) {
  return dueAt < Date.now()
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-default bg-elevated/30">
    <div class="flex items-center gap-2 border-b border-default px-3 py-2">
      <UIcon
        name="i-lucide-list-checks"
        class="size-4 shrink-0 text-primary"
      />
      <span class="text-sm font-medium text-default">Todos</span>
      <span class="text-xs text-dimmed">
        {{ openCount }} open of {{ known.length }}
      </span>
    </div>

    <ul class="divide-y divide-default">
      <li
        v-for="entry in rows"
        :key="entry.id"
        class="flex items-center gap-2 px-3 py-2"
      >
        <template v-if="entry.row && !entry.row.deletedAt">
          <UCheckbox
            :model-value="entry.row.done"
            :disabled="isPending(entry.id)"
            :aria-label="entry.row.title"
            @update:model-value="toggle(entry.id, $event === true)"
          />

          <input
            v-if="editingId === entry.id"
            v-model="draft"
            class="min-w-0 flex-1 bg-transparent text-sm text-default outline-none"
            :aria-label="`Rename ${entry.row.title}`"
            @keydown.enter.prevent="commit(entry.id)"
            @keydown.esc="editingId = null"
            @blur="commit(entry.id)"
          >
          <button
            v-else
            class="min-w-0 flex-1 cursor-text truncate text-left text-sm"
            :class="entry.row.done ? 'text-dimmed line-through' : 'text-default'"
            @click="startEditing(entry.id, entry.row.title)"
          >
            {{ entry.row.title }}
          </button>

          <span
            v-if="entry.row.dueAt && !entry.row.done"
            class="shrink-0 text-xs"
            :class="overdue(entry.row.dueAt) ? 'text-error' : 'text-dimmed'"
          >
            {{ dueLabel(entry.row.dueAt) }}
          </span>

          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :aria-label="`Remove ${entry.row.title}`"
            @click="remove(entry.id)"
          />
        </template>

        <!-- Kept visible on purpose: a row that quietly vanished from a list the
             user is looking at is worse than one that says it is gone. -->
        <span
          v-else
          class="text-xs text-dimmed"
        >
          {{ entry.row ? 'Removed' : 'No longer stored' }}
        </span>
      </li>
    </ul>
  </div>
</template>
