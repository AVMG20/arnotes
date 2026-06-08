<script setup lang="ts">
definePageMeta({ layout: 'app' })

const { ready, notes, createNote } = useNotes()

watch(ready, async (isReady) => {
  if (!isReady) return
  if (notes.value[0]) {
    navigateTo('/note/' + notes.value[0].id, { replace: true })
  } else {
    await createNote(undefined)
    if (notes.value[0]) {
      navigateTo('/note/' + notes.value[0].id, { replace: true })
    }
  }
}, { immediate: true })
</script>

<template>
  <div />
</template>
