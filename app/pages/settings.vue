<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({ layout: 'app' })

useSeoMeta({ title: 'Settings' })

const router = useRouter()
const { session, signOut } = useAuth()
const colorMode = useColorMode()
const { notes, activeNotes, allTags, activeNoteId } = useNotes()
const { primaryColor, neutralColor, PRIMARY_COLORS, NEUTRAL_COLORS, setPrimaryColor, setNeutralColor } = useUserSettings()
const { sidebarOpen } = useSidebar()

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
  neutral: '#737373', stone: '#78716c',
}

function swatchStyle(color: string, selected: boolean) {
  return {
    backgroundColor: COLOR_HEX[color] ?? '#888',
    ...(selected ? {
      transform: 'scale(1.15)',
      outline: `3px solid ${COLOR_HEX[color] ?? '#888'}`,
      outlineOffset: '2px',
    } : {}),
  }
}
</script>

<template>
  <!-- Main content -->
  <div class="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 lg:pb-0">
    <!-- Header -->
    <div class="sticky top-0 z-10 border-b border-default bg-default/95 backdrop-blur-sm shrink-0">
      <div class="px-4 pt-4 pb-3.5 flex items-center gap-3">
        <h1 class="font-semibold text-sm">Settings</h1>
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
          <div class="grid grid-cols-3 divide-x divide-default">
            <div class="p-5 flex items-center gap-3">
              <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-file-text" class="size-4 text-primary" />
              </div>
              <div>
                <p class="text-xl font-bold tabular-nums leading-none">{{ totalNotes }}</p>
                <p class="text-xs text-muted mt-1">{{ totalNotes === 1 ? 'Note' : 'Notes' }}</p>
              </div>
            </div>
            <div class="p-5 flex items-center gap-3">
              <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-tag" class="size-4 text-primary" />
              </div>
              <div>
                <p class="text-xl font-bold tabular-nums leading-none">{{ totalTags }}</p>
                <p class="text-xs text-muted mt-1">{{ totalTags === 1 ? 'Tag' : 'Tags' }}</p>
              </div>
            </div>
            <div class="p-5 flex items-center gap-3">
              <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-hard-drive" class="size-4 text-primary" />
              </div>
              <div>
                <p class="text-xl font-bold tabular-nums leading-none">{{ formatBytes(totalContentBytes) }}</p>
                <p class="text-xs text-muted mt-1">Content size</p>
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
              <p class="font-semibold truncate">{{ session?.user?.name }}</p>
              <p class="text-sm text-muted truncate">{{ session?.user?.email }}</p>
              <p class="text-xs text-muted mt-1">Member since {{ memberSince }}</p>
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
                <UIcon :name="isDark ? 'i-lucide-moon' : 'i-lucide-sun'" class="size-4 text-default" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium">Theme</p>
                <p class="text-xs text-muted mt-0.5">Switch between light and dark mode</p>
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
                  <UIcon name="i-lucide-palette" class="size-4 text-default" />
                </div>
                <div>
                  <p class="text-sm font-medium">Accent color</p>
                  <p class="text-xs text-muted mt-0.5">Buttons, highlights and interactive elements</p>
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
                  <UIcon name="i-lucide-circle-half-stroke" class="size-4 text-default" />
                </div>
                <div>
                  <p class="text-sm font-medium">Neutral color</p>
                  <p class="text-xs text-muted mt-0.5">Backgrounds, borders and text</p>
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
