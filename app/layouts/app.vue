<script setup lang="ts">
const { sidebarOpen } = useSidebar()

// Archive is an assistant in its own right. Floating the notes assistant on top
// of it would put two chat windows on one screen, each with its own memory.
const route = useRoute()
const isArchive = computed(() => route.path.startsWith('/archive'))
</script>

<template>
  <UDashboardGroup
    unit="px"
    storage="local"
    storage-key="notes-sidebar"
  >
    <UDashboardSidebar
      id="notes-sidebar"
      v-model:open="sidebarOpen"
      resizable
      :min-size="280"
      :default-size="360"
      :max-size="520"
      :toggle="false"
      :ui="{
        root: 'bg-default',
        header: 'hidden',
        body: 'p-0 gap-0 overflow-hidden',
        footer: 'hidden',
        handle: 'after:hover:bg-primary-500 after:transition-colors',
        content: 'max-w-[80vw]'
      }"
    >
      <AppSidebar @close="sidebarOpen = false" />
    </UDashboardSidebar>

    <div class="flex min-w-0 flex-1 overflow-hidden">
      <slot />
    </div>

    <NotesSearchModal />
    <AiChatWidget v-if="!isArchive" />
  </UDashboardGroup>
</template>
