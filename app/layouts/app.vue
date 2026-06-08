<script setup lang="ts">
const { sidebarOpen } = useSidebar()
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

    <!-- Page content -->
    <slot />

    <NotesSearchModal />
  </div>
</template>
