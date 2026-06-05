<script setup lang="ts">
const { ready, notes } = useNotes()

watch(ready, (isReady) => {
  if (isReady && notes.value[0]) {
    navigateTo('/' + notes.value[0].id, { replace: true })
  }
}, { immediate: true })
</script>

<template>
  <div />
</template>
