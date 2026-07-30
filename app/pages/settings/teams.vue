<script setup lang="ts">
definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Teams Settings' })

const { teams, activeTeamId, createTeam, setActiveTeam } = useTeams()
const { refreshNotes } = useNotes()

const newTeamName = ref('')
const createLoading = ref(false)
const createError = ref('')

const showManageModal = ref(false)
const showCreateModal = ref(false)
const showJoinModal = ref(false)

async function handleCreateTeam() {
  if (!newTeamName.value.trim()) return
  createLoading.value = true
  createError.value = ''
  try {
    await createTeam(newTeamName.value.trim())
    newTeamName.value = ''
    await refreshNotes()
  } catch (e: unknown) {
    createError.value = (e as Error)?.message || 'Failed to create team'
  } finally {
    createLoading.value = false
  }
}

async function handleSwitchTeam(id: string | null) {
  await setActiveTeam(id)
  await refreshNotes()
}

function manageTeam(id: string) {
  handleSwitchTeam(id).then(() => {
    showManageModal.value = true
  })
}
</script>

<template>
  <div class="h-full overflow-y-auto bg-default p-6 max-w-4xl mx-auto space-y-8">
    <div class="flex items-center justify-between border-b border-default pb-4">
      <div>
        <h1 class="text-xl font-bold text-default">
          Teams & Collaboration
        </h1>
        <p class="text-xs text-muted">
          Manage your teams and collaborate on shared notes.
        </p>
      </div>

      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        to="/settings"
      >
        Back to Settings
      </UButton>
    </div>

    <!-- Create / Join Team Section -->
    <div class="rounded-2xl border border-default bg-elevated/20 p-5 space-y-4">
      <h2 class="text-sm font-semibold text-default flex items-center gap-2">
        <UIcon
          name="i-lucide-plus-circle"
          class="size-4 text-primary"
        />
        Create New Team
      </h2>
      <form
        class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        @submit.prevent="handleCreateTeam"
      >
        <UInput
          v-model="newTeamName"
          placeholder="Team name (e.g., Engineering, Design)"
          class="flex-1"
          required
        />
        <UButton
          type="submit"
          color="primary"
          :loading="createLoading"
        >
          Create Team
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="soft"
          icon="i-lucide-key-round"
          @click="showJoinModal = true"
        >
          Join with Code
        </UButton>
      </form>

      <UAlert
        v-if="createError"
        color="error"
        variant="subtle"
        :description="createError"
      />
    </div>

    <!-- Team Selector / Overview -->
    <div class="space-y-4">
      <h2 class="text-sm font-semibold text-default flex items-center gap-2">
        <UIcon
          name="i-lucide-users"
          class="size-4 text-primary"
        />
        Your Teams ({{ teams.length }})
      </h2>

      <div
        v-if="teams.length === 0"
        class="rounded-xl border border-default p-6 text-center text-sm text-muted"
      >
        You are currently working in your Personal Workspace. Create a team above to start collaborating with others.
      </div>

      <div
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        <div
          v-for="t in teams"
          :key="t.id"
          class="rounded-xl border p-4 transition-all flex items-center justify-between gap-3"
          :class="activeTeamId === t.id ? 'border-primary bg-primary/5' : 'border-default bg-elevated/20 hover:bg-elevated/40'"
        >
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-default truncate text-sm">
              {{ t.name }}
            </p>
            <p class="text-xs text-muted truncate">
              {{ activeTeamId === t.id ? 'Active workspace' : 'Tap switch to activate' }}
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <UButton
              size="xs"
              :color="activeTeamId === t.id ? 'primary' : 'neutral'"
              :variant="activeTeamId === t.id ? 'solid' : 'outline'"
              @click="handleSwitchTeam(activeTeamId === t.id ? null : t.id)"
            >
              {{ activeTeamId === t.id ? 'Active' : 'Switch' }}
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-settings-2"
              aria-label="Manage team"
              @click="manageTeam(t.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <TeamManageModal
      v-model:open="showManageModal"
      v-model:create-open="showCreateModal"
      v-model:join-open="showJoinModal"
    />
  </div>
</template>
