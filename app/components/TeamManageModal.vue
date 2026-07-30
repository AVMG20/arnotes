<script setup lang="ts">
const props = defineProps<{
  open?: boolean
  createOpen?: boolean
  joinOpen?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:createOpen': [value: boolean]
  'update:joinOpen': [value: boolean]
}>()

const {
  activeTeam,
  activeTeamId,
  activeTeamMembers,
  isTeamOwner,
  isTeamAdmin,
  mustTransferBeforeLeaving,
  createTeam,
  joinTeamWithCode,
  updateTeamName,
  rotateJoinCode,
  removeMember,
  transferOwnership,
  leaveTeam,
  deleteTeam
} = useTeams()
const { session } = useAuth()
const { refreshNotes } = useNotes()
const toast = useToast()

const isOpen = computed({
  get: () => props.open ?? false,
  set: val => emit('update:open', val)
})

const isCreateOpen = computed({
  get: () => props.createOpen ?? false,
  set: val => emit('update:createOpen', val)
})

const isJoinOpen = computed({
  get: () => props.joinOpen ?? false,
  set: val => emit('update:joinOpen', val)
})

// Create Team form
const newTeamName = ref('')
const createLoading = ref(false)
const createError = ref('')

// Join Team form
const joinCodeInput = ref('')
const joinLoading = ref(false)
const joinError = ref('')

// Copy code status
const copiedCode = ref(false)
const generatingCode = ref(false)

async function handleGenerateCode() {
  if (!activeTeamId.value) return
  generatingCode.value = true
  try {
    await rotateJoinCode(activeTeamId.value)
  } catch (e: unknown) {
    toast.add({
      title: (e as Error)?.message || 'Could not generate a join code',
      icon: 'i-lucide-alert-triangle',
      color: 'error'
    })
  } finally {
    generatingCode.value = false
  }
}

async function copyTeamCode() {
  if (!activeTeam.value?.joinCode) return
  try {
    await navigator.clipboard.writeText(activeTeam.value.joinCode)
    copiedCode.value = true
    setTimeout(() => {
      copiedCode.value = false
    }, 2000)
  } catch {
    toast.add({
      title: 'Could not copy automatically',
      description: 'Select and copy the code manually.',
      icon: 'i-lucide-alert-triangle',
      color: 'error'
    })
  }
}

async function handleJoinTeam() {
  if (!joinCodeInput.value.trim()) return
  joinLoading.value = true
  joinError.value = ''
  try {
    await joinTeamWithCode(joinCodeInput.value.trim())
    joinCodeInput.value = ''
    isJoinOpen.value = false
    await refreshNotes()
  } catch (e: unknown) {
    joinError.value = (e as Error)?.message || 'Failed to join team'
  } finally {
    joinLoading.value = false
  }
}

async function handleCreateTeam() {
  if (!newTeamName.value.trim()) return
  createLoading.value = true
  createError.value = ''
  try {
    await createTeam(newTeamName.value.trim())
    newTeamName.value = ''
    isCreateOpen.value = false
    // Creating a team switches the active workspace, so the note list is stale.
    await refreshNotes()
  } catch (e: unknown) {
    createError.value = (e as Error)?.message || 'Failed to create team'
  } finally {
    createLoading.value = false
  }
}

// Team name editing
const isEditingName = ref(false)
const nameInput = ref('')
const nameSaving = ref(false)
const nameError = ref('')

watch(activeTeam, (team) => {
  if (!isEditingName.value) nameInput.value = team?.name ?? ''
}, { immediate: true })

function startEditingName() {
  nameInput.value = activeTeam.value?.name ?? ''
  nameError.value = ''
  isEditingName.value = true
}

async function handleSaveName() {
  if (!activeTeamId.value || !nameInput.value.trim()) return
  nameSaving.value = true
  nameError.value = ''
  try {
    await updateTeamName(activeTeamId.value, nameInput.value.trim())
    isEditingName.value = false
  } catch (e: unknown) {
    nameError.value = (e as Error)?.message || 'Failed to update team name'
  } finally {
    nameSaving.value = false
  }
}

// ─── Confirmation dialog (replaces browser confirm()/alert()) ──────────────

interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  color: 'error' | 'warning'
  action: () => Promise<unknown> | unknown
}

const confirmRequest = ref<ConfirmRequest | null>(null)
const confirmLoading = ref(false)
const isConfirmOpen = computed({
  get: () => confirmRequest.value !== null,
  set: (val) => { if (!val) confirmRequest.value = null }
})

function askConfirm(request: ConfirmRequest) {
  confirmRequest.value = request
}

async function handleConfirmAccept() {
  if (!confirmRequest.value) return
  confirmLoading.value = true
  try {
    await confirmRequest.value.action()
    confirmRequest.value = null
  } catch (e: unknown) {
    toast.add({
      title: (e as Error)?.message || 'Something went wrong',
      icon: 'i-lucide-alert-triangle',
      color: 'error'
    })
  } finally {
    confirmLoading.value = false
  }
}

function confirmRotateCode() {
  if (!activeTeamId.value) return
  const organizationId = activeTeamId.value
  askConfirm({
    title: 'Rotate join code?',
    description: 'The current join code will stop working immediately. Anyone with the old code will no longer be able to join.',
    confirmLabel: 'Rotate',
    color: 'warning',
    action: () => rotateJoinCode(organizationId)
  })
}

function confirmRemoveMember(memberId: string, memberName: string) {
  askConfirm({
    title: 'Remove member?',
    description: `Remove ${memberName} from ${activeTeam.value?.name}? They will lose access to the team's notes.`,
    confirmLabel: 'Remove',
    color: 'error',
    action: () => removeMember(memberId)
  })
}

function confirmTransferOwnership(memberId: string, memberName: string) {
  askConfirm({
    title: 'Transfer ownership?',
    description: `Make ${memberName} the new owner of ${activeTeam.value?.name}? You will become an admin.`,
    confirmLabel: 'Transfer',
    color: 'warning',
    action: () => transferOwnership(memberId)
  })
}

function confirmLeaveTeam() {
  if (!activeTeamId.value) return
  const organizationId = activeTeamId.value
  const isLastMember = activeTeamMembers.value.length === 1
  askConfirm({
    title: isLastMember ? 'Delete this team?' : 'Leave this team?',
    description: isLastMember
      ? `You're the only member of ${activeTeam.value?.name}. Leaving will permanently delete the team and all of its notes.`
      : `Are you sure you want to leave ${activeTeam.value?.name}?`,
    confirmLabel: isLastMember ? 'Delete Team' : 'Leave Team',
    color: 'error',
    action: async () => {
      await leaveTeam(organizationId)
      isOpen.value = false
      // Dropped back to the personal workspace — reload its notes.
      await refreshNotes()
    }
  })
}

function confirmDeleteTeam() {
  if (!activeTeamId.value) return
  const organizationId = activeTeamId.value
  askConfirm({
    title: 'Delete this team?',
    description: `Are you sure you want to delete ${activeTeam.value?.name}? This will permanently delete the team and all of its notes. This action cannot be undone.`,
    confirmLabel: 'Delete Team',
    color: 'error',
    action: async () => {
      await deleteTeam(organizationId)
      isOpen.value = false
      await refreshNotes()
    }
  })
}
</script>

<template>
  <div>
    <!-- Create Team Modal -->
    <UModal
      v-model:open="isCreateOpen"
      title="Create New Team"
      description="Collaborate on notes with your teammates."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="handleCreateTeam"
        >
          <UFormField
            label="Team Name"
            required
          >
            <UInput
              v-model="newTeamName"
              placeholder="e.g. Acme Engineering"
              class="w-full"
              required
            />
          </UFormField>

          <UAlert
            v-if="createError"
            color="error"
            variant="subtle"
            :description="createError"
          />

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="soft"
              @click="isCreateOpen = false"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              color="primary"
              :loading="createLoading"
            >
              Create Team
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <!-- Join Team Modal -->
    <UModal
      v-model:open="isJoinOpen"
      title="Join Team with Code"
      description="Enter a team code shared by a teammate to join."
    >
      <template #body>
        <form
          class="space-y-4"
          @submit.prevent="handleJoinTeam"
        >
          <UFormField
            label="Team Code"
            hint="Enter the join code shared by a teammate"
            required
          >
            <UInput
              v-model="joinCodeInput"
              placeholder="e.g. K3F9QX7BM2H8YRWZ"
              class="w-full font-mono uppercase"
              required
            />
          </UFormField>

          <UAlert
            v-if="joinError"
            color="error"
            variant="subtle"
            :description="joinError"
          />

          <div class="flex justify-end gap-2 pt-2">
            <UButton
              color="neutral"
              variant="soft"
              @click="isJoinOpen = false"
            >
              Cancel
            </UButton>
            <UButton
              type="submit"
              color="primary"
              :loading="joinLoading"
            >
              Join Team
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <!-- Team Management Modal -->
    <UModal
      v-model:open="isOpen"
      :title="activeTeam ? `Team Settings: ${activeTeam.name}` : 'Team Settings'"
      description="Manage members and permissions."
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div
          v-if="activeTeam"
          class="space-y-6 text-sm"
        >
          <!-- Team Name -->
          <div
            v-if="isTeamAdmin"
            class="rounded-xl border border-default p-4 space-y-2"
          >
            <p class="text-xs font-semibold text-muted uppercase tracking-wider">
              Team Name
            </p>
            <div
              v-if="!isEditingName"
              class="flex items-center justify-between gap-2"
            >
              <span class="font-medium text-default">{{ activeTeam.name }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="startEditingName"
              >
                Edit
              </UButton>
            </div>
            <form
              v-else
              class="flex items-center gap-2"
              @submit.prevent="handleSaveName"
            >
              <UInput
                v-model="nameInput"
                class="flex-1"
                required
              />
              <UButton
                type="submit"
                size="xs"
                color="primary"
                :loading="nameSaving"
              >
                Save
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                @click="isEditingName = false"
              >
                Cancel
              </UButton>
            </form>
            <UAlert
              v-if="nameError"
              color="error"
              variant="subtle"
              :description="nameError"
            />
          </div>

          <!-- Team Join Code Banner -->
          <div class="rounded-xl border border-default p-4 bg-primary/5 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold text-muted uppercase tracking-wider">
                Team Join Code
              </p>
              <p
                v-if="activeTeam.joinCode"
                class="font-mono text-sm font-bold text-primary truncate"
              >
                {{ activeTeam.joinCode }}
              </p>
              <p
                v-else
                class="text-sm text-muted"
              >
                No code yet
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <!-- Teams created before join codes existed have none, so admins get a
                   plain generate action instead of a destructive rotate. -->
              <UButton
                v-if="isTeamAdmin && !activeTeam.joinCode"
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-key-round"
                :loading="generatingCode"
                @click="handleGenerateCode"
              >
                Generate Code
              </UButton>
              <template v-if="activeTeam.joinCode">
                <UButton
                  v-if="isTeamAdmin"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  @click="confirmRotateCode"
                >
                  Rotate
                </UButton>
                <UButton
                  size="xs"
                  color="primary"
                  variant="soft"
                  :icon="copiedCode ? 'i-lucide-check' : 'i-lucide-copy'"
                  @click="copyTeamCode"
                >
                  {{ copiedCode ? 'Copied!' : 'Copy Code' }}
                </UButton>
              </template>
            </div>
          </div>

          <!-- Members List -->
          <div class="space-y-2">
            <h3 class="font-medium text-default text-xs uppercase tracking-wider text-muted">
              Team Members
            </h3>
            <div
              v-if="activeTeamMembers.length === 0"
              class="py-4 text-center text-xs text-muted"
            >
              No members listed.
            </div>
            <div
              v-else
              class="divide-y divide-default rounded-xl border border-default overflow-hidden"
            >
              <div
                v-for="m in activeTeamMembers"
                :key="m.id"
                class="flex items-center justify-between px-3 py-2.5 bg-elevated/10"
              >
                <div class="flex items-center gap-2.5 min-w-0">
                  <UAvatar
                    :alt="m.user?.name || m.user?.email || 'M'"
                    size="xs"
                  />
                  <div class="min-w-0">
                    <p class="font-medium text-default truncate text-xs">
                      {{ m.user?.name || m.user?.email }}
                      <span
                        v-if="m.userId === session?.user?.id"
                        class="text-muted font-normal"
                      >(you)</span>
                    </p>
                    <p
                      v-if="m.user?.name"
                      class="text-[11px] text-muted truncate"
                    >
                      {{ m.user?.email }}
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <UBadge
                    size="xs"
                    variant="subtle"
                    :color="m.role === 'owner' ? 'primary' : 'neutral'"
                  >
                    {{ m.role }}
                  </UBadge>

                  <template v-if="m.userId !== session?.user?.id">
                    <UButton
                      v-if="isTeamOwner && m.role !== 'owner'"
                      icon="i-lucide-crown"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      aria-label="Transfer ownership"
                      @click="confirmTransferOwnership(m.id, m.user?.name || m.user?.email || 'this member')"
                    />
                    <UButton
                      v-if="isTeamAdmin"
                      icon="i-lucide-trash-2"
                      size="xs"
                      color="error"
                      variant="ghost"
                      aria-label="Remove member"
                      @click="confirmRemoveMember(m.id, m.user?.name || m.user?.email || 'this member')"
                    />
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Danger Zone -->
          <div class="border-t border-default pt-4 flex flex-wrap justify-between gap-2">
            <UTooltip
              :text="mustTransferBeforeLeaving ? 'Transfer ownership to another member before leaving.' : undefined"
              :disabled="!mustTransferBeforeLeaving"
            >
              <UButton
                color="warning"
                variant="soft"
                size="xs"
                icon="i-lucide-log-out"
                :disabled="mustTransferBeforeLeaving"
                @click="confirmLeaveTeam"
              >
                Leave Team
              </UButton>
            </UTooltip>
            <UButton
              v-if="isTeamOwner"
              color="error"
              variant="soft"
              size="xs"
              icon="i-lucide-trash-2"
              @click="confirmDeleteTeam"
            >
              Delete Team
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Confirmation Modal. Declared last on purpose: modals teleport in template
         order, so anything that has to stack above the team settings modal must
         come after it. -->
    <UModal
      v-model:open="isConfirmOpen"
      :title="confirmRequest?.title"
      :description="confirmRequest?.description"
      :ui="{ overlay: 'z-[60]', content: 'z-[60]' }"
    >
      <template #body>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :disabled="confirmLoading"
            @click="isConfirmOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            :color="confirmRequest?.color"
            :loading="confirmLoading"
            @click="handleConfirmAccept"
          >
            {{ confirmRequest?.confirmLabel }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
