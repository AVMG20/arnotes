<script setup lang="ts">
const { sidebarOpen } = useSidebar()
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
        content: 'max-w-[calc(100%-2rem)]'
      }"
    >
      <AppSidebar @close="sidebarOpen = false" />
    </UDashboardSidebar>

    <div class="flex min-w-0 flex-1 overflow-hidden">
      <slot />
    </div>

    <NotesSearchModal />
  </UDashboardGroup>
</template>
