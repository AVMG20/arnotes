<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { activeNoteId, createNote } = useNotes()
const searchOpen = useSearchModal()

watch(activeNoteId, () => emit('close'))
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-default shrink-0 bg-default">
      <AppLogo class="text-xl ml-2 mr-5 shrink-0" />

      <button
        class="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-default bg-elevated/50 hover:bg-elevated text-sm text-muted transition-colors"
        @click="searchOpen = true"
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
        @click="createNote(undefined)"
      />
    </div>

    <div class="flex flex-1 min-h-0">
      <NotesTagsPanel class="w-44 shrink-0" />
      <NotesListPanel class="flex-1 min-w-0" />
    </div>
  </div>
</template>
