<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const { activeNote, activeNoteId, createNote, deleteNote } = useNotes()
const searchModal = ref<{ open: boolean } | null>(null)

// ─── Delete confirmation ─────────────────────────────────────

const deleteModalOpen = ref(false)

async function confirmDelete() {
  if (!activeNote.value) return
  const id = activeNote.value.id
  deleteModalOpen.value = false
  await deleteNote(id)
}

// ─── Global keyboard shortcuts ───────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (!e.metaKey && !e.ctrlKey) return
  if (e.key === 'k') {
    e.preventDefault()
    if (searchModal.value) searchModal.value.open = true
  }
  else if (e.key === 'n') {
    e.preventDefault()
    createNote(undefined)
  }
  else if (e.key === 'w') {
    e.preventDefault()
    if (activeNote.value) deleteModalOpen.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <NotesSidebar class="w-68 shrink-0" @open-search="searchModal && (searchModal.open = true)" />
    <NotesEditor class="flex-1 min-w-0" />
    <NotesSearchModal ref="searchModal" />

    <!-- Cmd+W delete confirmation -->
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
