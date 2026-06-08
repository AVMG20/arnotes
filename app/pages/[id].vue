<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const route = useRoute()
const router = useRouter()
const { activeNoteId, activeNote, createNote, deleteNote } = useNotes()
const searchOpen = useSearchModal()
const sidebarOpen = ref(false)
const deleteModalOpen = ref(false)

// Back/forward: route param → active note
watch(() => route.params.id, id => {
  if (typeof id === 'string' && id !== activeNoteId.value) {
    activeNoteId.value = id
  }
}, { immediate: true })

// Any state change (click, create, delete) → push URL
watch(activeNoteId, id => {
  if (id && route.params.id !== id) router.push('/' + id)
  else if (!id) router.replace('/')
})

async function confirmDelete() {
  if (!activeNote.value) return
  const id = activeNote.value.id
  deleteModalOpen.value = false
  await deleteNote(id)
}

function onKeydown(e: KeyboardEvent) {
  if (!e.metaKey && !e.ctrlKey) return
  if (e.key === 'k') { e.preventDefault(); searchOpen.value = true }
  else if (e.key === 'n') { e.preventDefault(); createNote(undefined) }
  else if (e.key === 'w') { e.preventDefault(); if (activeNote.value) deleteModalOpen.value = true }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-dvh overflow-hidden">
    <!-- Desktop sidebar -->
    <div class="hidden lg:flex flex-col shrink-0 border-r border-default" style="width: 460px">
      <AppSidebar />
    </div>

    <!-- Mobile sidebar drawer -->
    <USlideover
        v-model:open="sidebarOpen"
        side="left"
        :ui="{ content: 'max-w-[calc(100%-10vw)]' }"
    >
      <template #content>
        <AppSidebar @close="sidebarOpen = false" />
      </template>
    </USlideover>

    <!-- Editor (with bottom padding on mobile for the nav bar) -->
    <NotesEditor class="flex-1 min-w-0 pb-14 lg:pb-0" />

    <!-- Mobile bottom nav bar -->
    <div
      class="fixed bottom-0 left-0 right-0 z-20 lg:hidden flex items-center justify-around px-8 border-t border-default bg-default/95 backdrop-blur-sm"
      style="padding-top: 0.5rem; padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
    >
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        size="md"
        aria-label="Open sidebar"
        @click="sidebarOpen = true"
      />
      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        size="md"
        aria-label="Search notes"
        @click="searchOpen = true"
      />
      <UButton
        icon="i-lucide-square-pen"
        color="primary"
        variant="soft"
        size="md"
        aria-label="New note"
        @click="createNote(undefined)"
      />
    </div>

    <NotesSearchModal />

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
