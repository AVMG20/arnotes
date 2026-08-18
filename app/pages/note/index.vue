<script setup lang="ts">
definePageMeta({ layout: 'app' })

const { ready, activeNotes, createNote } = useNotes()

watch(ready, async (isReady) => {
  if (!isReady) return
  const first = activeNotes.value[0] ?? await createNote()
  if (first) navigateTo('/note/' + first.id, { replace: true })
}, { immediate: true })
</script>

<template>
  <div />
</template>
