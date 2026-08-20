<script setup lang="ts">
import { format } from 'date-fns'

interface ApiKeySummary {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
}

interface ApiKeysResponse {
  workspace: { id: string | null, name: string }
  keys: ApiKeySummary[]
}

const { activeTeamId } = useTeams()
const toast = useToast()

const { data, status, refresh } = useFetch<ApiKeysResponse>('/api/settings/api-keys', { server: false, lazy: true })

// Keys belong to one workspace, so switching teams shows a different set.
watch(activeTeamId, () => refresh())

const keys = computed(() => data.value?.keys ?? [])
const workspaceName = computed(() => data.value?.workspace.name ?? 'this workspace')

const EXPIRY_OPTIONS = [
  { label: 'Never expires', value: 0 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 }
]

// One toggle per permission, in the order they are advertised to a client.
const PERMISSIONS = [
  { scope: 'notes:read', label: 'Read notes', description: 'Search, list and read' },
  { scope: 'notes:write', label: 'Write notes', description: 'Create, edit and trash' },
  { scope: 'boards:read', label: 'Read boards', description: 'Boards, tasks and updates' },
  { scope: 'boards:write', label: 'Write boards', description: 'Create, edit, move and delete' }
] as const

const newName = ref('')
const granted = ref<Record<string, boolean>>(
  Object.fromEntries(PERMISSIONS.map(permission => [permission.scope, true]))
)
const expiresInDays = ref(0)
const creating = ref(false)

// The key itself only exists in this response — once it is dismissed it is gone.
const issuedToken = ref<string | null>(null)
const copied = ref(false)

const scopes = computed(() => PERMISSIONS.filter(p => granted.value[p.scope]).map(p => p.scope))

const canCreate = computed(() => newName.value.trim().length > 0 && scopes.value.length > 0)

function errMsg(e: unknown): string | undefined {
  return (e as { data?: { message?: string } })?.data?.message
}

async function createKey() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const response = await $fetch<{ token: string }>('/api/settings/api-keys', {
      method: 'POST',
      body: {
        name: newName.value.trim(),
        scopes: scopes.value,
        expiresInDays: expiresInDays.value === 0 ? null : expiresInDays.value
      }
    })
    issuedToken.value = response.token
    copied.value = false
    newName.value = ''
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not create the key', description: errMsg(e), icon: 'i-lucide-alert-triangle', color: 'error' })
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  if (!issuedToken.value) return
  try {
    await navigator.clipboard.writeText(issuedToken.value)
    copied.value = true
    toast.add({ title: 'Key copied', icon: 'i-lucide-check', duration: 2000 })
  } catch {
    toast.add({ title: 'Could not copy — select the key and copy it manually', icon: 'i-lucide-alert-triangle', color: 'error' })
  }
}

const revoking = ref<string | null>(null)

async function revokeKey(key: ApiKeySummary) {
  revoking.value = key.id
  try {
    await $fetch(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' })
    toast.add({ title: `Revoked "${key.name}"`, icon: 'i-lucide-trash', duration: 2000 })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not revoke the key', description: errMsg(e), icon: 'i-lucide-alert-triangle', color: 'error' })
  } finally {
    revoking.value = null
  }
}

// Badges read "notes: write", short enough to sit beside a key name.
function scopeLabel(scope: string): string {
  const [feature, permission] = scope.split(':')
  return `${feature} ${permission}`
}

function scopeColor(scope: string) {
  return scope.endsWith(':write') ? 'warning' as const : 'neutral' as const
}

function formatDate(value: number): string {
  return format(new Date(value), 'PP')
}

function expiryLabel(key: ApiKeySummary): string {
  if (!key.expiresAt) return 'never expires'
  return key.expiresAt <= Date.now() ? 'expired' : `expires ${formatDate(key.expiresAt)}`
}
</script>

<template>
  <div class="rounded-xl border border-default bg-default overflow-hidden">
    <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
      <UIcon
        name="i-lucide-plug-zap"
        class="size-4 text-primary"
      />
      <span class="text-xs font-semibold text-muted uppercase tracking-wider">API keys &amp; MCP</span>
      <UButton
        to="/mcp"
        label="Setup guide"
        icon="i-lucide-book-open"
        color="neutral"
        variant="ghost"
        size="xs"
        class="ml-auto"
      />
    </div>

    <div class="divide-y divide-default">
      <!-- Intro -->
      <div class="px-5 py-4 flex items-start gap-4">
        <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
          <UIcon
            name="i-lucide-bot"
            class="size-4 text-default"
          />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium">
            Connect an AI agent
          </p>
          <p class="text-xs text-muted mt-0.5">
            An API key lets Claude Code, Claude Desktop or any other MCP client read and write these notes.
            Keys are issued for one workspace — these belong to
            <span class="font-medium text-default">{{ workspaceName }}</span>.
          </p>
        </div>
      </div>

      <!-- One-time key reveal -->
      <div
        v-if="issuedToken"
        class="px-5 py-4 bg-primary/5"
      >
        <div class="flex items-start gap-4">
          <div class="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-key-round"
              class="size-4 text-primary"
            />
          </div>
          <div class="flex-1 min-w-0 space-y-2">
            <p class="text-sm font-medium">
              Copy your key now
            </p>
            <p class="text-xs text-muted">
              This is the only time it is shown. Arnotes stores a hash of it, so it cannot be displayed again.
            </p>
            <div class="flex gap-2">
              <code class="flex-1 min-w-0 text-xs font-mono bg-default border border-default rounded-md px-3 py-2 overflow-x-auto whitespace-nowrap">{{ issuedToken }}</code>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                :label="copied ? 'Copied' : 'Copy'"
                color="primary"
                size="sm"
                @click="copyToken"
              />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Dismiss key"
                @click="issuedToken = null"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Create -->
      <div class="px-5 py-4 space-y-3">
        <div class="flex items-center gap-4">
          <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-plus"
              class="size-4 text-default"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium">
              New key
            </p>
            <p class="text-xs text-muted mt-0.5">
              Give it a name you will recognise, and only the permissions it needs
            </p>
          </div>
        </div>

        <div class="pl-12 space-y-3">
          <UInput
            v-model="newName"
            placeholder="Claude Code on my laptop"
            icon="i-lucide-tag"
            class="w-full"
            :disabled="creating"
            @keydown.enter="createKey"
          />

          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <UCheckbox
              v-for="permission in PERMISSIONS"
              :key="permission.scope"
              v-model="granted[permission.scope]"
              :label="permission.label"
              :description="permission.description"
            />
            <USelect
              v-model="expiresInDays"
              :items="EXPIRY_OPTIONS"
              value-key="value"
              size="sm"
              class="w-40"
            />
            <UButton
              label="Create key"
              icon="i-lucide-key-round"
              size="sm"
              color="primary"
              class="ml-auto"
              :disabled="!canCreate"
              :loading="creating"
              @click="createKey"
            />
          </div>

          <p
            v-if="!scopes.length"
            class="text-xs text-error"
          >
            Pick at least one permission.
          </p>
        </div>
      </div>

      <!-- Existing keys -->
      <div class="px-5 py-4 space-y-3">
        <div class="flex items-center gap-4">
          <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
            <UIcon
              name="i-lucide-list"
              class="size-4 text-default"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium">
              Active keys
            </p>
            <p class="text-xs text-muted mt-0.5">
              Revoking a key immediately disconnects anything using it
            </p>
          </div>
        </div>

        <div class="pl-12">
          <p
            v-if="status === 'pending'"
            class="text-xs text-muted"
          >
            Loading keys…
          </p>
          <p
            v-else-if="!keys.length"
            class="text-xs text-muted"
          >
            No keys yet. Create one above, then follow the
            <NuxtLink
              to="/mcp"
              class="text-primary underline"
            >setup guide</NuxtLink>.
          </p>

          <div
            v-else
            class="divide-y divide-default border border-default rounded-lg"
          >
            <div
              v-for="key in keys"
              :key="key.id"
              class="px-3 py-2.5 flex items-center gap-3"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="text-sm font-medium truncate">
                    {{ key.name }}
                  </p>
                  <UBadge
                    v-for="scope in key.scopes"
                    :key="scope"
                    :label="scopeLabel(scope)"
                    :color="scopeColor(scope)"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <p class="text-xs text-muted mt-0.5 truncate">
                  <code class="font-mono">{{ key.keyPrefix }}…</code>
                  · created {{ formatDate(key.createdAt) }}
                  · {{ key.lastUsedAt ? `last used ${formatDate(key.lastUsedAt)}` : 'never used' }}
                  · {{ expiryLabel(key) }}
                </p>
              </div>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :aria-label="`Revoke ${key.name}`"
                :loading="revoking === key.id"
                @click="revokeKey(key)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
