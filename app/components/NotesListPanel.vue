<script setup lang="ts">
import { ref, watch } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'

const { ready, filteredNotes, activeNoteId, activeTag, showTrash, showShared, deleteNote, restoreNote } = useNotes()

const scrollArea = useTemplateRef('scrollArea')

// Reset scroll position when list changes (tag switch, search, trash toggle)
watch(filteredNotes, async () => {
  await nextTick()
  scrollArea.value?.virtualizer?.scrollToIndex(0, { align: 'start' })
})

// ─── Permanent delete confirmation ──────────────────────────
const permDeleteTarget = ref<string | null>(null)
const permDeleteModalOpen = ref(false)

function requestPermanentDelete(id: string) {
  permDeleteTarget.value = id
  permDeleteModalOpen.value = true
}

async function confirmPermanentDelete() {
  if (permDeleteTarget.value) {
    await deleteNote(permDeleteTarget.value)
    permDeleteTarget.value = null
  }
  permDeleteModalOpen.value = false
}
</script>

<template>
  <div class="flex flex-col h-full bg-default">
    <!-- Active tag, shared, or trash label -->
    <div v-if="activeTag || showTrash || showShared" class="px-3 pt-2 pb-0 shrink-0">
      <div class="flex items-center gap-1.5 text-xs text-muted">
        <UIcon :name="showTrash ? 'i-lucide-trash-2' : showShared ? 'i-lucide-globe' : 'i-lucide-filter'" class="size-3 shrink-0" />
        <span v-if="showTrash" class="font-medium">Deleted notes</span>
        <span v-else-if="showShared" class="font-medium">Shared notes</span>
        <span v-else class="text-primary-600 dark:text-primary-400 font-medium">#{{ activeTag }}</span>
      </div>
    </div>

    <!-- Notes list -->
    <template v-if="ready">
      <UScrollArea
          v-if="filteredNotes.length > 0"
          ref="scrollArea"
          v-slot="{ item: note }"
          :items="filteredNotes"
          :virtualize="{
            estimateSize: 56,
            overscan: 20,
            paddingStart: 8,
            paddingEnd: 8,
            gap: 2,
          }"
          class="flex-1 m-2"
          :ui="{ viewport: 'px-2' }"
      >
        <div
            class="group relative flex flex-col gap-0.5 px-2.5 py-2 rounded-lg transition-colors"
            :class="activeNoteId === note.id ? 'bg-elevated' : 'hover:bg-elevated/50'"
            @click="activeNoteId = note.id"
        >
          <!-- Title row -->
          <div class="flex items-start gap-1">
            <p class="font-medium text-sm text-default leading-snug line-clamp-2 flex-1 min-w-0">
              {{ note.title || 'Untitled' }}
            </p>

            <!-- Normal note: soft-delete button -->
            <UButton
                v-if="!note.deletedAt"
                icon="i-lucide-trash-2"
                size="xs"
                color="neutral"
                variant="ghost"
                class="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 shrink-0 -mt-0.5 -mr-1.5"
                aria-label="Delete"
                @click.stop="deleteNote(note.id)"
            />

            <!-- Deleted note: restore + permanent delete -->
            <div
                v-else
                class="flex items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 shrink-0 -mt-0.5 -mr-1.5"
            >
              <UButton
                  icon="i-lucide-undo-2"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Restore"
                  @click.stop="restoreNote(note.id)"
              />
              <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  aria-label="Delete permanently"
                  @click.stop="requestPermanentDelete(note.id)"
              />
            </div>
          </div>

          <!-- Date -->
          <span class="text-xs text-muted">{{ relativeTime(note.updatedAt) }}</span>
        </div>
      </UScrollArea>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-10 gap-2 text-center flex-1">
        <UIcon :name="showTrash ? 'i-lucide-trash-2' : showShared ? 'i-lucide-globe' : 'i-lucide-file-x'" class="size-7 text-muted" />
        <p class="text-xs text-muted">{{ showTrash ? 'Trash is empty' : showShared ? 'No shared notes' : 'No notes' }}</p>
      </div>
    </template>

    <!-- Loading -->
    <div v-else class="flex items-center justify-center py-10 flex-1">
      <UIcon name="i-lucide-loader-circle" class="size-5 text-muted animate-spin" />
    </div>

    <!-- Permanent delete confirmation modal -->
    <UModal
        v-model:open="permDeleteModalOpen"
        title="Delete permanently?"
        description="This note will be permanently deleted and cannot be recovered."
        :ui="{ footer: 'justify-end' }"
    >
      <template #footer>
        <UButton label="Cancel" color="neutral" variant="ghost" @click="permDeleteModalOpen = false" />
        <UButton label="Delete forever" color="error" @click="confirmPermanentDelete" />
      </template>
    </UModal>
  </div>
</template>
