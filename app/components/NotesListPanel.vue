<script setup lang="ts">
import { ref, computed } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'

const { ready, filteredNotes, activeNoteId, activeTag, deleteNote } = useNotes()

// ─── Delete confirmation ─────────────────────────────────────

const deleteTarget = ref<{ id: string; title: string } | null>(null)
const deleteModalOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (v) => { if (!v) deleteTarget.value = null }
})

function requestDelete(id: string, title: string) {
  deleteTarget.value = { id, title }
}

async function confirmDelete() {
  if (deleteTarget.value) {
    await deleteNote(deleteTarget.value.id)
    deleteTarget.value = null
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-default">
    <!-- Active tag label -->
    <div v-if="activeTag" class="px-3 pt-2 pb-0 shrink-0">
      <div class="flex items-center gap-1.5 text-xs text-muted">
        <UIcon name="i-lucide-filter" class="size-3 shrink-0" />
        <span class="text-primary-600 dark:text-primary-400 font-medium">#{{ activeTag }}</span>
      </div>
    </div>

    <!-- Notes list -->
    <div class="flex-1 overflow-y-auto py-2 px-2">
      <template v-if="ready">
        <div
          v-for="note in filteredNotes"
          :key="note.id"
          class="group relative flex flex-col gap-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors mb-0.5"
          :class="activeNoteId === note.id
            ? 'bg-elevated'
            : 'hover:bg-elevated/50'"
          @click="activeNoteId = note.id"
        >
          <!-- Title row -->
          <div class="flex items-start gap-1">
            <p class="font-medium text-sm text-default leading-snug line-clamp-2 flex-1 min-w-0">
              {{ note.title || 'Untitled' }}
            </p>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              class="opacity-0 group-hover:opacity-100 shrink-0 -mt-0.5 -mr-1.5"
              aria-label="Delete"
              @click.stop="requestDelete(note.id, note.title || 'Untitled')"
            />
          </div>

          <!-- Date -->
          <span class="text-xs text-muted">{{ relativeTime(note.updatedAt) }}</span>
        </div>

        <div v-if="filteredNotes.length === 0" class="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <UIcon name="i-lucide-file-x" class="size-7 text-muted" />
          <p class="text-xs text-muted">No notes</p>
        </div>
      </template>

      <div v-else class="flex items-center justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-5 text-muted animate-spin" />
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <UModal
      v-model:open="deleteModalOpen"
      :title="`Delete '${deleteTarget?.title}'?`"
      description="This note will be permanently deleted and cannot be recovered."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer>
        <UButton label="Cancel" color="neutral" variant="ghost" @click="deleteModalOpen = false" />
        <UButton label="Delete" color="error" @click="confirmDelete" />
      </template>
    </UModal>
  </div>
</template>
