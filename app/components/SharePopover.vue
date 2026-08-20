<script setup lang="ts">
import { ref, watch } from 'vue'
import { differenceInCalendarDays } from 'date-fns'

// The share control, one copy for everything that can be handed out as a
// read-only link. Notes and boards share the same deal — on or off, optionally
// until a date — so they share the same panel; the parent only persists.
const props = defineProps<{
  isPublic: boolean
  publicUntil: number | null
  /** Absolute URL of the public page, shown and copied once sharing is on. */
  link: string
  /** What is being shared, lowercase, for the wording: 'note', 'board'. */
  subject: string
  save: (isPublic: boolean, publicUntil: number | null) => Promise<{ isPublic: boolean, publicUntil: number | null }>
}>()

const toast = useToast()

const open = ref(false)
const endDate = ref('')
const saving = ref(false)

const today = computed(() => new Date().toISOString().slice(0, 10))
const Subject = computed(() => props.subject.charAt(0).toUpperCase() + props.subject.slice(1))

// The field is filled from the stored date each time the panel opens, so a
// half-typed date left behind by a previous visit never gets saved by accident.
watch(open, (isOpen) => {
  if (isOpen) endDate.value = formatEndDate(props.publicUntil)
})

watch(() => props.publicUntil, (value) => {
  if (!open.value) endDate.value = formatEndDate(value)
})

function formatEndDate(timestamp: number | null) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function expiry() {
  if (!endDate.value) return null
  const expiresAt = new Date(`${endDate.value}T23:59:59.999`).getTime()
  return Number.isNaN(expiresAt) ? null : expiresAt
}

function expiryLabel(timestamp: number | null) {
  if (!timestamp) return 'Shared indefinitely'
  const days = Math.max(0, differenceInCalendarDays(new Date(timestamp), new Date()))
  const weeks = Math.floor(days / 7)
  return `Expires in ${weeks} ${weeks === 1 ? 'week' : 'weeks'} and ${days % 7} ${days % 7 === 1 ? 'day' : 'days'}`
}

async function copyLink() {
  if (!props.link) return
  await navigator.clipboard.writeText(props.link)
  toast.add({ title: 'Link copied', icon: 'i-lucide-clipboard-check', duration: 2000 })
}

async function submit(isPublic: boolean) {
  const publicUntil = isPublic ? expiry() : null
  if (publicUntil && publicUntil <= Date.now()) {
    toast.add({ title: 'Choose a future end date', icon: 'i-lucide-calendar-x', color: 'error', duration: 3000 })
    return
  }
  saving.value = true
  try {
    const updated = await props.save(isPublic, publicUntil)
    endDate.value = formatEndDate(updated.publicUntil)
    toast.add({
      title: updated.isPublic ? `${Subject.value} is shared` : 'Sharing stopped',
      description: updated.isPublic && updated.publicUntil ? `Available through ${formatEndDate(updated.publicUntil)}` : undefined,
      icon: updated.isPublic ? 'i-lucide-globe' : 'i-lucide-lock',
      duration: 2500
    })
  } catch {
    toast.add({ title: 'Could not update sharing', icon: 'i-lucide-alert-triangle', color: 'error', duration: 3000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', sideOffset: 8 }"
    @open-auto-focus.prevent
  >
    <UButton
      :icon="isPublic ? 'i-lucide-globe' : 'i-lucide-share-2'"
      size="xs"
      :color="isPublic ? 'primary' : 'neutral'"
      variant="ghost"
      :aria-label="`Share ${subject}`"
    >
      <span class="hidden sm:inline">Share</span>
    </UButton>

    <template #content>
      <div class="w-80 p-3 space-y-3">
        <div class="flex items-start gap-2">
          <div class="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
            <UIcon
              name="i-lucide-globe-2"
              class="size-4"
            />
          </div>
          <div>
            <p class="text-sm font-medium text-default">
              Share this {{ subject }}
            </p>
            <p class="text-xs text-muted">
              {{ isPublic ? 'Anyone with the link can view it.' : 'Create a view-only public link.' }}
            </p>
          </div>
        </div>

        <UFormField
          label="End date"
          hint="Optional"
        >
          <UInput
            v-model="endDate"
            type="date"
            :min="today"
            class="w-full"
          />
          <template #hint>
            <span class="text-xs text-muted">Leave empty to share indefinitely</span>
          </template>
        </UFormField>

        <div
          v-if="isPublic"
          class="rounded-md bg-elevated px-2.5 py-2"
        >
          <p class="text-xs font-medium text-default">
            Link is active
          </p>
          <p class="mt-0.5 text-xs text-muted truncate">
            {{ link }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ expiryLabel(publicUntil) }}
          </p>
        </div>

        <div class="flex gap-2">
          <UButton
            :label="isPublic ? 'Save changes' : `Share ${subject}`"
            icon="i-lucide-send"
            size="sm"
            class="flex-1 justify-center"
            :loading="saving"
            @click="submit(true)"
          />
          <UButton
            v-if="isPublic"
            label="Copy link"
            icon="i-lucide-copy"
            size="sm"
            color="neutral"
            variant="soft"
            @click="copyLink"
          />
        </div>

        <UButton
          v-if="isPublic"
          label="Stop sharing"
          icon="i-lucide-lock"
          size="sm"
          color="error"
          variant="ghost"
          block
          :loading="saving"
          @click="submit(false)"
        />
      </div>
    </template>
  </UPopover>
</template>
