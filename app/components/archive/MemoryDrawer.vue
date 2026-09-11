<script setup lang="ts">
import { computed } from 'vue'

// The viewer behind a click in the sidebar: the memory as a live card — the
// same editable card a reply draws — with the todos that came out of it. Opens
// from anywhere Archive is on screen, because the id it watches is shared.
const { openMemoryId, memories, todos, openMemory, restoreMemory } = useArchive()
const toast = useToast()

const memory = computed(() => openMemoryId.value ? memories.value[openMemoryId.value] : null)

const linkedTodoIds = computed(() => {
  const id = openMemoryId.value
  if (!id) return []
  return Object.values(todos.value)
    .filter(todo => todo.memoryId === id && !todo.deletedAt)
    .sort((a, b) => a.position - b.position)
    .map(todo => todo.id)
})

const isOpen = computed({
  get: () => openMemoryId.value !== null,
  set: (value: boolean) => { if (!value) openMemory(null) }
})

function dateLabel(ts: number) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

async function restore() {
  if (!openMemoryId.value) return
  try {
    await restoreMemory(openMemoryId.value)
  } catch {
    toast.add({ title: 'Could not restore that memory', color: 'error' })
  }
}
</script>

<template>
  <USlideover
    v-model:open="isOpen"
    title="Stored memory"
    :description="memory ? `Archive keeps this under “${memory.title}”` : 'This memory is no longer stored.'"
    :ui="{ content: 'max-w-xl', body: 'space-y-4' }"
  >
    <template #body>
      <template v-if="memory">
        <ArchiveMemoryCard :memory-id="memory.id" />

        <UAlert
          v-if="memory.deletedAt"
          color="neutral"
          variant="soft"
          icon="i-lucide-archive-restore"
          title="Forgotten"
          description="Archive no longer sees this memory. Restore it to put it back in reach."
          :actions="[{ label: 'Restore', color: 'neutral', variant: 'solid', onClick: restore }]"
        />

        <div v-if="linkedTodoIds.length">
          <p class="mb-2 text-xs font-medium uppercase tracking-wider text-dimmed">
            Work from this memory
          </p>
          <ArchiveTodoCard :ids="linkedTodoIds" />
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-dimmed">
          <dt>Stored</dt>
          <dd class="text-muted">
            {{ dateLabel(memory.createdAt) }}
          </dd>
          <dt>Last changed</dt>
          <dd class="text-muted">
            {{ dateLabel(memory.updatedAt) }}
          </dd>
          <dt>Id</dt>
          <dd class="font-mono text-muted">
            {{ memory.id }}
          </dd>
        </dl>
      </template>

      <p
        v-else
        class="text-sm text-muted"
      >
        Nothing to show.
      </p>
    </template>
  </USlideover>
</template>
