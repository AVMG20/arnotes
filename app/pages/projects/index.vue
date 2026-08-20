<script setup lang="ts">
definePageMeta({ layout: 'app' })

const { appMode, sidebarOpen } = useSidebar()
appMode.value = 'projects'

const { ready, projects, createProject } = useProjects()
const route = useRoute()

// Like /note → most recent note: land on the most recently updated board.
// ?new=1 (the sidebar's new-project button) keeps you here to name one.
const wantsNew = computed(() => route.query.new === '1')

watch([ready, wantsNew], ([isReady]) => {
  if (!isReady || wantsNew.value) return
  const top = projects.value[0]
  if (top) navigateTo(`/projects/${top.id}`, { replace: true })
}, { immediate: true })

// A frame of this page while a redirect is pending reads as a flash of "no
// projects", so nothing paints until we know there is nothing to open.
const showEmptyState = computed(() => ready.value && (projects.value.length === 0 || wantsNew.value))

const name = ref('')
const creating = ref(false)
const nameEl = ref<HTMLInputElement | null>(null)

watch(showEmptyState, async (show) => {
  if (!show) return
  await nextTick()
  nameEl.value?.focus()
}, { immediate: true })

async function handleCreate() {
  const value = name.value.trim()
  if (!value || creating.value) return
  creating.value = true
  try {
    const project = await createProject(value)
    name.value = ''
    navigateTo(`/projects/${project.id}`)
  } finally {
    creating.value = false
  }
}

function cancel() {
  name.value = ''
  const top = projects.value[0]
  navigateTo(top ? `/projects/${top.id}` : '/projects', { replace: true })
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex shrink-0 items-center gap-2 border-b border-default px-4 py-3 lg:px-6 lg:hidden">
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Open sidebar"
        @click="sidebarOpen = true"
      />
      <span class="text-base font-semibold text-default">Projects</span>
    </header>

    <div
      v-if="!showEmptyState"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted"
      />
    </div>

    <div
      v-else
      class="flex min-h-0 flex-1 items-center justify-center px-6"
    >
      <div class="w-full max-w-sm">
        <div class="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-kanban"
            class="size-5"
          />
        </div>
        <h1 class="mt-4 text-lg font-semibold text-default">
          {{ wantsNew ? 'New project' : 'Your first project' }}
        </h1>
        <p class="mt-1 text-sm text-muted">
          Boards start with Backlog, To do, Verify and Done. Rename, reorder or remove columns anytime.
        </p>

        <form
          class="mt-5 flex items-center gap-2"
          @submit.prevent="handleCreate"
        >
          <input
            ref="nameEl"
            v-model="name"
            placeholder="Project name"
            class="min-w-0 flex-1 rounded-lg border border-default bg-default px-3 py-2 text-sm text-default outline-none transition-colors focus:border-primary placeholder:text-dimmed"
            @keydown.escape="cancel"
          >
          <UButton
            type="submit"
            label="Create"
            color="primary"
            :loading="creating"
            :disabled="!name.trim()"
          />
        </form>

        <button
          v-if="wantsNew && projects.length"
          class="mt-3 text-xs text-muted transition-colors hover:text-default"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
