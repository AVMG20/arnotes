<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { teams, activeTeam, setActiveTeam } = useTeams()
const { refreshNotes } = useNotes()
const { refresh: refreshProjects } = useProjects()

const showManageModal = ref(false)
const showCreateModal = ref(false)
const showJoinModal = ref(false)

async function handleSelectTeam(id: string | null) {
  await setActiveTeam(id)
  await refreshNotes()
  await refreshProjects()
}

const dropdownItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = []

  // Personal workspace item
  items.push({
    label: 'Personal Workspace',
    icon: 'i-lucide-user',
    active: !activeTeam.value,
    onSelect: () => handleSelectTeam(null)
  })

  if (teams.value.length > 0) {
    items.push({
      type: 'label',
      label: 'Your Teams'
    })

    teams.value.forEach((t) => {
      items.push({
        label: t.name,
        icon: 'i-lucide-users',
        active: activeTeam.value?.id === t.id,
        onSelect: () => handleSelectTeam(t.id)
      })
    })
  }

  items.push({
    type: 'separator'
  })

  items.push({
    label: 'Create Team',
    icon: 'i-lucide-plus',
    onSelect: () => { showCreateModal.value = true }
  })

  items.push({
    label: 'Join Team with Code',
    icon: 'i-lucide-key-round',
    onSelect: () => { showJoinModal.value = true }
  })

  if (activeTeam.value) {
    items.push({
      label: 'Team Settings & Members',
      icon: 'i-lucide-settings-2',
      onSelect: () => { showManageModal.value = true }
    })
  }

  return items
})
</script>

<template>
  <div>
    <UDropdownMenu
      :items="dropdownItems"
      :content="{ align: 'start', collisionPadding: 12 }"
      :ui="{ content: 'w-56' }"
    >
      <button class="flex w-full items-center gap-2 rounded-lg border border-default bg-elevated/50 px-2.5 py-1.5 text-xs text-default hover:bg-elevated transition-colors">
        <div class="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary font-medium">
          <UIcon
            :name="activeTeam ? 'i-lucide-users' : 'i-lucide-user'"
            class="size-3.5"
          />
        </div>
        <span class="min-w-0 flex-1 truncate text-left font-medium">
          {{ activeTeam ? activeTeam.name : 'Personal Workspace' }}
        </span>
        <UBadge
          v-if="activeTeam"
          size="xs"
          variant="subtle"
          color="neutral"
          class="shrink-0 text-[10px]"
        >
          Team
        </UBadge>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="size-3.5 shrink-0 opacity-50"
        />
      </button>
    </UDropdownMenu>

    <TeamManageModal
      v-model:open="showManageModal"
      v-model:create-open="showCreateModal"
      v-model:join-open="showJoinModal"
    />
  </div>
</template>
