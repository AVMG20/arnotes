<script setup lang="ts">
import type { Note } from '~/composables/useNotes'

definePageMeta({ layout: 'app' })

const { ready, notes, createNote } = useNotes()

watch(ready, async (isReady) => {
  if (!isReady) return
  if (notes.value[0]) {
    navigateTo('/note/' + notes.value[0].id, { replace: true })
  } else {
    await createNote(undefined)
    const createdNote = notes.value[0] as Note | undefined
    if (createdNote) {
      navigateTo('/note/' + createdNote.id, { replace: true })
    }
  }
}, { immediate: true })
</script>

<template>
  <div />
</template>
