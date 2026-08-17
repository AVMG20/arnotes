<script setup lang="ts">
definePageMeta({ layout: 'app' })

const { ready, activeNotes, createNote } = useNotes()

// Land on the most recent *note*: the store also holds tasks, and those belong
// to the tasks view, not to the notes editor.
watch(ready, async (isReady) => {
  if (!isReady) return
  const first = activeNotes.value[0] ?? await createNote()
  if (first) navigateTo('/note/' + first.id, { replace: true })
}, { immediate: true })
</script>

<template>
  <div />
</template>
