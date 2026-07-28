<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({ layout: 'app' })

useSeoMeta({ title: 'Settings' })

const router = useRouter()
const { session, signOut } = useAuth()
const colorMode = useColorMode()
const { notes, activeNotes, allTags, activeNoteId } = useNotes()
const { primaryColor, neutralColor, PRIMARY_COLORS, NEUTRAL_COLORS, setPrimaryColor, setNeutralColor, openrouterApiKeyMasked, openrouterModel, POPULAR_OPENROUTER_MODELS, setOpenRouterApiKey, setOpenRouterModel } = useUserSettings()
const { sidebarOpen } = useSidebar()

const toast = useToast()

function errMsg(e: unknown): string | undefined {
  return (e as { data?: { message?: string } })?.data?.message
}

// ─── AI settings ─────────────────────────────────────────────
const apiKeyInput = ref('')
const showApiKey = ref(false)
const apiKeySaving = ref(false)
const apiKeyDirty = computed(() => apiKeyInput.value.trim() !== '')

const modelInput = ref('')
type ModelCatalog = {
  models: Array<{ id: string, name: string, contextLength: number | null, modality: string | null, inputPrice: number | null, outputPrice: number | null }>
}
const { data: modelCatalog, status: modelCatalogStatus, refresh: refreshModelCatalog } = useFetch<ModelCatalog>('/api/settings/models', { server: false, lazy: true })
const modelsRefreshing = ref(false)

const { data: aiHistory } = useFetch<{ totals: { prompts: number, cost: number } }>('/api/settings/ai-history', { server: false, lazy: true })

function formatContextLength(tokens: number | null): string | null {
  if (!tokens) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M context`
  return `${Math.round(tokens / 1000)}k context`
}

function formatPricePerMillion(price: number | null): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  const perMillion = price * 1_000_000
  return `$${perMillion.toLocaleString(undefined, { maximumFractionDigits: 4 })}/M`
}

async function forceRefreshModelCatalog() {
  modelsRefreshing.value = true
  try {
    modelCatalog.value = await $fetch<ModelCatalog>('/api/settings/models?refresh=true')
    toast.add({ title: 'Models and pricing refreshed', icon: 'i-lucide-refresh-cw', duration: 2000 })
  } catch (e) {
    toast.add({ title: 'Could not refresh models', description: errMsg(e), icon: 'i-lucide-alert-triangle', color: 'error' })
  } finally {
    modelsRefreshing.value = false
  }
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)
}

const modelOptions = computed(() => {
  const catalog = modelCatalog.value?.models
  const options = catalog?.length
    ? catalog.map(model => ({
        label: model.name,
        value: model.id,
        description: [
          model.id,
          formatContextLength(model.contextLength),
          model.inputPrice !== null ? `Input ${formatPricePerMillion(model.inputPrice)}` : null,
          model.outputPrice !== null ? `Output ${formatPricePerMillion(model.outputPrice)}` : null
        ].filter(Boolean).join(' · ')
      }))
    : POPULAR_OPENROUTER_MODELS.map(model => ({ label: model, value: model, description: 'Popular model' }))

  if (modelInput.value && !options.some(option => option.value === modelInput.value)) {
    options.unshift({ label: modelInput.value, value: modelInput.value, description: 'Current model' })
  }
  return options
})

watch(openrouterModel, (v) => {
  modelInput.value = v
}, { immediate: true })

async function saveApiKey() {
  if (!apiKeyInput.value.trim()) return
  apiKeySaving.value = true
  try {
    await setOpenRouterApiKey(apiKeyInput.value)
    apiKeyInput.value = ''
    toast.add({ title: 'API key saved', icon: 'i-lucide-check', duration: 2000 })
  } catch (e) {
    toast.add({ title: 'Failed to save API key', description: errMsg(e), icon: 'i-lucide-alert-triangle', color: 'error' })
  } finally {
    apiKeySaving.value = false
  }
}

async function clearApiKey() {
  apiKeySaving.value = true
  try {
    await setOpenRouterApiKey('')
    apiKeyInput.value = ''
    toast.add({ title: 'API key removed', icon: 'i-lucide-trash', duration: 2000 })
  } finally {
    apiKeySaving.value = false
  }
}

async function changeModel(model: string) {
  try {
    await setOpenRouterModel(model)
    toast.add({ title: 'Model updated', icon: 'i-lucide-check', duration: 1500 })
  } catch (e) {
    toast.add({ title: 'Failed to update model', description: errMsg(e), icon: 'i-lucide-alert-triangle', color: 'error' })
  }
}

const openrouterDocsUrl = 'https://openrouter.ai/keys'

// Clear so clicking any note (including the already-active one) triggers navigation
activeNoteId.value = null

watch(activeNoteId, (id) => {
  if (id) router.push('/note/' + id)
})

const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

const userInitials = computed(() => {
  const name = session.value?.user?.name
  if (!name) return '?'
  return name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
})

const memberSince = computed(() => {
  const date = session.value?.user?.createdAt
  if (!date) return '—'
  return format(new Date(date), 'MMMM yyyy')
})

const totalNotes = computed(() => activeNotes.value.length)
const totalTags = computed(() => allTags.value.length)
const totalPrompts = computed(() => aiHistory.value?.totals.prompts ?? 0)
const totalAiCost = computed(() => aiHistory.value?.totals.cost ?? 0)

const totalContentBytes = computed(() => {
  const enc = new TextEncoder()
  return notes.value.reduce((sum, n) => sum + enc.encode(n.content).byteLength, 0)
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Hardcoded hex values — Tailwind v4 doesn't generate CSS vars for dynamic class references
const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', slate: '#64748b', gray: '#6b7280', zinc: '#71717a',
  neutral: '#737373', stone: '#78716c'
}

function swatchStyle(color: string, selected: boolean) {
  return {
    backgroundColor: COLOR_HEX[color] ?? '#888',
    ...(selected
      ? {
          transform: 'scale(1.15)',
          outline: `3px solid ${COLOR_HEX[color] ?? '#888'}`,
          outlineOffset: '2px'
        }
      : {})
  }
}
</script>

<template>
  <!-- Main content -->
  <div class="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 lg:pb-0">
    <!-- Header -->
    <div class="sticky top-0 z-10 border-b border-default bg-default/95 backdrop-blur-sm shrink-0">
      <div class="px-4 pt-3.5 pb-3 flex items-center gap-3">
        <h1 class="font-semibold text-sm">
          Settings
        </h1>
        <UButton
          to="/settings/ai-history"
          label="AI history"
          icon="i-lucide-history"
          color="neutral"
          variant="ghost"
          size="xs"
          class="ml-auto"
        />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <UContainer class="py-6">
        <div class="flex flex-col gap-4">
          <!-- Stats — full width -->
          <div class="rounded-xl border border-default bg-default overflow-hidden">
            <div class="px-5 py-3 border-b border-default bg-elevated/40">
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">Your stats</span>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 divide-x divide-default">
              <div class="p-5 flex items-center gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon
                    name="i-lucide-file-text"
                    class="size-4 text-primary"
                  />
                </div>
                <div>
                  <p class="text-xl font-bold tabular-nums leading-none">
                    {{ totalNotes }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    {{ totalNotes === 1 ? 'Note' : 'Notes' }}
                  </p>
                </div>
              </div>
              <div class="p-5 flex items-center gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon
                    name="i-lucide-sparkles"
                    class="size-4 text-primary"
                  />
                </div>
                <div>
                  <p class="text-xl font-bold tabular-nums leading-none">
                    {{ totalPrompts }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    {{ totalPrompts === 1 ? 'AI prompt' : 'AI prompts' }}
                  </p>
                </div>
              </div>
              <div class="p-5 flex items-center gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon
                    name="i-lucide-wallet-cards"
                    class="size-4 text-primary"
                  />
                </div>
                <div>
                  <p class="text-xl font-bold tabular-nums leading-none">
                    {{ formatMoney(totalAiCost) }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    AI spent
                  </p>
                </div>
              </div>
              <div class="p-5 flex items-center gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon
                    name="i-lucide-tag"
                    class="size-4 text-primary"
                  />
                </div>
                <div>
                  <p class="text-xl font-bold tabular-nums leading-none">
                    {{ totalTags }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    {{ totalTags === 1 ? 'Tag' : 'Tags' }}
                  </p>
                </div>
              </div>
              <div class="p-5 flex items-center gap-3">
                <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <UIcon
                    name="i-lucide-hard-drive"
                    class="size-4 text-primary"
                  />
                </div>
                <div>
                  <p class="text-xl font-bold tabular-nums leading-none">
                    {{ formatBytes(totalContentBytes) }}
                  </p>
                  <p class="text-xs text-muted mt-1">
                    Content size
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Account -->
          <div class="rounded-xl border border-default bg-default overflow-hidden">
            <div class="px-5 py-3 border-b border-default bg-elevated/40">
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">Account</span>
            </div>
            <div class="p-5 flex items-center gap-4">
              <UAvatar
                :src="session?.user?.image ?? undefined"
                :alt="userInitials"
                size="xl"
              />
              <div class="min-w-0">
                <p class="font-semibold truncate">
                  {{ session?.user?.name }}
                </p>
                <p class="text-sm text-muted truncate">
                  {{ session?.user?.email }}
                </p>
                <p class="text-xs text-muted mt-1">
                  Member since {{ memberSince }}
                </p>
              </div>
              <UButton
                label="Sign out"
                icon="i-lucide-log-out"
                variant="ghost"
                color="error"
                size="sm"
                class="ml-auto shrink-0"
                @click="signOut"
              />
            </div>
          </div>

          <!-- Appearance -->
          <div class="rounded-xl border border-default bg-default overflow-hidden">
            <div class="px-5 py-3 border-b border-default bg-elevated/40">
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">Appearance</span>
            </div>

            <div class="divide-y divide-default">
              <!-- Dark mode -->
              <div class="px-5 py-4 flex items-center gap-4">
                <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
                  <UIcon
                    :name="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
                    class="size-4 text-default"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">
                    Theme
                  </p>
                  <p class="text-xs text-muted mt-0.5">
                    Switch between light and dark mode
                  </p>
                </div>
                <UButton
                  :label="isDark ? 'Light mode' : 'Dark mode'"
                  variant="soft"
                  color="neutral"
                  size="sm"
                  class="shrink-0"
                  @click="toggleColorMode"
                />
              </div>

              <!-- Primary color -->
              <div class="px-5 py-4 space-y-3">
                <div class="flex items-center gap-4">
                  <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
                    <UIcon
                      name="i-lucide-palette"
                      class="size-4 text-default"
                    />
                  </div>
                  <div>
                    <p class="text-sm font-medium">
                      Accent color
                    </p>
                    <p class="text-xs text-muted mt-0.5">
                      Buttons, highlights and interactive elements
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 pl-12">
                  <button
                    v-for="color in PRIMARY_COLORS"
                    :key="color"
                    :title="color"
                    class="size-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                    :style="swatchStyle(color, primaryColor === color)"
                    @click="setPrimaryColor(color as any)"
                  >
                    <UIcon
                      v-if="primaryColor === color"
                      name="i-lucide-check"
                      class="size-3.5 text-white mx-auto drop-shadow"
                    />
                  </button>
                </div>
              </div>

              <!-- Neutral color -->
              <div class="px-5 py-4 space-y-3">
                <div class="flex items-center gap-4">
                  <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
                    <UIcon
                      name="i-lucide-circle-half-stroke"
                      class="size-4 text-default"
                    />
                  </div>
                  <div>
                    <p class="text-sm font-medium">
                      Neutral color
                    </p>
                    <p class="text-xs text-muted mt-0.5">
                      Backgrounds, borders and text
                    </p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 pl-12">
                  <button
                    v-for="color in NEUTRAL_COLORS"
                    :key="color"
                    :title="color"
                    class="size-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                    :style="swatchStyle(color, neutralColor === color)"
                    @click="setNeutralColor(color as any)"
                  >
                    <UIcon
                      v-if="neutralColor === color"
                      name="i-lucide-check"
                      class="size-3.5 text-white mx-auto drop-shadow"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- AI -->
          <div class="rounded-xl border border-default bg-default overflow-hidden">
            <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
              <UIcon
                name="i-lucide-sparkles"
                class="size-4 text-primary"
              />
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">AI (OpenRouter)</span>
            </div>

            <div class="divide-y divide-default">
              <!-- API key -->
              <div class="px-5 py-4 space-y-3">
                <div class="flex items-center gap-4">
                  <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
                    <UIcon
                      name="i-lucide-key-round"
                      class="size-4 text-default"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium">
                      API key
                    </p>
                    <p class="text-xs text-muted mt-0.5">
                      Stored securely on your account. Get one at
                      <a
                        :href="openrouterDocsUrl"
                        target="_blank"
                        rel="noopener"
                        class="text-primary underline"
                      >openrouter.ai/keys</a>
                    </p>
                  </div>
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :loading="modelsRefreshing"
                    aria-label="Refresh OpenRouter models and pricing"
                    @click="forceRefreshModelCatalog"
                  />
                </div>

                <div class="pl-12 space-y-2">
                  <div
                    v-if="openrouterApiKeyMasked"
                    class="flex items-center gap-2 text-xs text-muted"
                  >
                    <UIcon
                      name="i-lucide-check-circle-2"
                      class="size-3.5 text-primary"
                    />
                    <span>Current key: <code class="font-mono">{{ openrouterApiKeyMasked }}</code></span>
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="error"
                      icon="i-lucide-trash-2"
                      label="Remove"
                      :loading="apiKeySaving"
                      @click="clearApiKey"
                    />
                  </div>

                  <div class="flex gap-2">
                    <UInput
                      v-model="apiKeyInput"
                      :type="showApiKey ? 'text' : 'password'"
                      placeholder="sk-or-v1-…"
                      icon="i-lucide-key"
                      class="flex-1"
                      :ui="{ trailing: 'pe-1' }"
                    >
                      <template #trailing>
                        <UButton
                          color="neutral"
                          variant="link"
                          size="sm"
                          :icon="showApiKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                          :aria-label="showApiKey ? 'Hide key' : 'Show key'"
                          @click="showApiKey = !showApiKey"
                        />
                      </template>
                    </UInput>
                    <UButton
                      label="Save"
                      icon="i-lucide-check"
                      size="sm"
                      color="primary"
                      :disabled="!apiKeyDirty"
                      :loading="apiKeySaving"
                      @click="saveApiKey"
                    />
                  </div>
                </div>
              </div>

              <!-- Model -->
              <div class="px-5 py-4 space-y-3">
                <div class="flex items-center gap-4">
                  <div class="size-8 rounded-lg bg-elevated flex items-center justify-center shrink-0">
                    <UIcon
                      name="i-lucide-cpu"
                      class="size-4 text-default"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium">
                      Model
                    </p>
                    <p class="text-xs text-muted mt-0.5">
                      Compare input and output prices per million tokens before choosing a model
                    </p>
                  </div>
                </div>
                <div class="pl-12">
                  <USelectMenu
                    v-model="modelInput"
                    :items="modelOptions"
                    value-key="value"
                    placeholder="Pick a model"
                    create-item
                    virtualize
                    :loading="modelCatalogStatus === 'pending'"
                    :search-input="{ placeholder: 'Search all OpenRouter models…' }"
                    :filter-fields="['label', 'value']"
                    class="w-full"
                    @update:model-value="changeModel"
                    @create="changeModel"
                  />
                  <p class="text-xs text-muted mt-1.5">
                    Active: <code class="font-mono">{{ openrouterModel }}</code>
                    <span class="block mt-0.5">
                      <template v-if="modelCatalogStatus === 'error'">
                        Could not load the catalog.
                        <button
                          type="button"
                          class="text-primary underline"
                          @click="refreshModelCatalog()"
                        >Try again</button>, or type any OpenRouter slug and press Enter.
                      </template>
                      <template v-else>
                        Prices come from OpenRouter and are shown per million input and output tokens. Search the complete catalog, or type any model slug and press Enter.
                      </template>
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </UContainer>
    </div>
  </div>

  <!-- Mobile bottom nav -->
  <div
    class="fixed bottom-0 left-0 right-0 z-20 lg:hidden flex items-center justify-around px-8 border-t border-default bg-default/95 backdrop-blur-sm"
    style="padding-top: 0.5rem; padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
  >
    <UButton
      icon="i-lucide-panel-left"
      color="neutral"
      variant="ghost"
      size="md"
      aria-label="Open sidebar"
      @click="sidebarOpen = true"
    />
    <UButton
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
      size="md"
      aria-label="Back to notes"
      @click="navigateTo('/note')"
    />
  </div>
</template>
