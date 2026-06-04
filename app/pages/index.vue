<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const { activeNote, createNote, deleteNote } = useNotes()
const searchModal = ref<{ open: boolean } | null>(null)

const deleteModalOpen = ref(false)

async function confirmDelete() {
  if (!activeNote.value) return
  const id = activeNote.value.id
  deleteModalOpen.value = false
  await deleteNote(id)
}

function onKeydown(e: KeyboardEvent) {
  if (!e.metaKey && !e.ctrlKey) return
  if (e.key === 'k') { e.preventDefault(); if (searchModal.value) searchModal.value.open = true }
  else if (e.key === 'n') { e.preventDefault(); createNote(undefined) }
  else if (e.key === 'w') { e.preventDefault(); if (activeNote.value) deleteModalOpen.value = true }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <!-- Dual sidebar -->
    <div class="flex flex-col shrink-0 border-r border-default" style="width: 460px">
      <!-- Shared header across both panels -->
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-default shrink-0 bg-default">
        <img src="/logo.png" alt="Easy Notes" class="h-8 w-auto ml-2 mr-5 shrink-0" />

        <!-- Search trigger — grows to fill available space -->
        <button
          class="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-default bg-elevated/50 hover:bg-elevated text-sm text-muted transition-colors"
          @click="searchModal && (searchModal.open = true)"
        >
          <UIcon name="i-lucide-search" class="size-3.5 shrink-0" />
          <span class="flex-1 text-left text-xs truncate">Search notes…</span>
          <span class="text-xs text-muted/60 font-mono shrink-0 hidden sm:block">⌘K</span>
        </button>

        <UButton
          icon="i-lucide-plus"
          size="sm"
          color="primary"
          variant="soft"
          aria-label="New note"
          class="shrink-0"
          @click="() => createNote(undefined)"
        />
      </div>

      <!-- Tags + list side by side -->
      <div class="flex flex-1 min-h-0">
        <NotesTagsPanel class="w-52 shrink-0" />
        <NotesListPanel class="flex-1 min-w-0" />
      </div>
    </div>

    <!-- Editor -->
    <NotesEditor class="flex-1 min-w-0" />

    <NotesSearchModal ref="searchModal" />

    <UModal
      v-model:open="deleteModalOpen"
      :title="`Delete '${activeNote?.title || 'Untitled'}'?`"
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
