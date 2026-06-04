<script setup lang="ts">
import { ref, computed } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'

const { ready, filteredNotes, allTags, activeNoteId, activeTag, searchQuery, createNote, deleteNote, trackTagClick } = useNotes()

const totalCount = computed(() => useNotes().notes.value.length)

// ─── Delete confirmation modal ───────────────────────────────

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


function selectTag(tag: string | null) {
  activeTag.value = tag
  searchQuery.value = ''
  if (tag) trackTagClick(tag)
}

// ─── Search modal open signal ────────────────────────────────

const emit = defineEmits<{ openSearch: [] }>()
</script>

<template>
  <div class="flex flex-col h-full border-r border-default bg-default">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
      <span class="font-semibold text-base text-default">Notes</span>
      <UButton
        icon="i-lucide-plus"
        size="sm"
        color="primary"
        variant="soft"
        aria-label="New note"
        @click="() => createNote()"
      />
    </div>

    <!-- Search trigger (full width) -->
    <div class="px-3 py-2 shrink-0">
      <button
        class="flex items-center gap-2 w-full px-3 py-1.5 rounded-md border border-default bg-elevated/50 hover:bg-elevated text-sm text-muted transition-colors"
        @click="emit('openSearch')"
      >
        <UIcon name="i-lucide-search" class="size-3.5 shrink-0" />
        <span class="flex-1 text-left">Search notes…</span>
        <UKbd size="sm" class="hidden sm:flex gap-0.5">
          <span>⌘K</span>
        </UKbd>
      </button>
    </div>

    <!-- Tag navigation -->
    <div class="px-3 pb-2 shrink-0">
      <button
        class="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm transition-colors"
        :class="!activeTag ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-medium' : 'text-muted hover:bg-elevated'"
        @click="selectTag(null)"
      >
        <span class="flex items-center gap-2">
          <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0" />
          All Notes
        </span>
        <span class="text-xs tabular-nums opacity-60">{{ totalCount }}</span>
      </button>

      <div v-if="allTags.length > 0" class="mt-2 space-y-0.5">
        <div class="px-2 py-1 text-xs font-semibold text-muted uppercase tracking-wider">Tags</div>
        <button
          v-for="{ tag, count } in allTags"
          :key="tag"
          class="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm transition-colors"
          :class="activeTag === tag ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-medium' : 'text-muted hover:bg-elevated'"
          @click="selectTag(tag)"
        >
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="text-primary-500 font-medium text-xs shrink-0">#</span>
            <span class="truncate">{{ tag }}</span>
          </span>
          <span class="text-xs tabular-nums opacity-60 shrink-0 ml-1">{{ count }}</span>
        </button>
      </div>
    </div>

    <div class="border-t border-default mx-3 shrink-0" />

    <!-- Notes list -->
    <div class="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
      <template v-if="ready">
        <div
          v-for="note in filteredNotes"
          :key="note.id"
          class="group relative flex flex-col gap-1 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
          :class="activeNoteId === note.id ? 'bg-elevated' : 'hover:bg-elevated/60'"
          @click="activeNoteId = note.id"
        >
          <div class="flex items-start justify-between gap-1">
            <p class="font-medium text-sm text-default leading-snug line-clamp-1 flex-1 min-w-0">
              {{ note.title || 'Untitled' }}
            </p>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              class="opacity-0 group-hover:opacity-100 shrink-0 -mt-0.5 -mr-1"
              aria-label="Delete note"
              @click.stop="requestDelete(note.id, note.title || 'Untitled')"
            />
          </div>

          <span class="text-xs text-muted">{{ relativeTime(note.updatedAt) }}</span>
        </div>

        <div v-if="filteredNotes.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
          <UIcon name="i-lucide-file-search" class="size-8 text-muted mb-2" />
          <p class="text-sm text-muted">No notes found</p>
        </div>
      </template>

      <div v-else class="flex items-center justify-center py-8">
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
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteModalOpen = false"
        />
        <UButton
          label="Delete"
          color="error"
          @click="confirmDelete"
        />
      </template>
    </UModal>
  </div>
</template>
