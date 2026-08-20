<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { differenceInCalendarDays } from 'date-fns'
import { htmlToMarkdown } from '~/utils/markdown'

const { activeNoteId, autoFocus, getNote, createNote, updateNote, updateSharing } = useNotes()
const toast = useToast()

const noteId = computed(() => activeNoteId.value)
const note = computed(() => getNote(noteId.value))

const editorRef = ref()

const shareOpen = ref(false)
const shareEndDate = ref('')
const sharing = ref(false)

watch(shareOpen, (open) => {
  if (open) shareEndDate.value = formatShareEndDate(note.value?.publicUntil ?? null)
})

function formatShareEndDate(timestamp: number | null) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function getShareExpiry() {
  if (!shareEndDate.value) return null
  const expiresAt = new Date(`${shareEndDate.value}T23:59:59.999`).getTime()
  return Number.isNaN(expiresAt) ? null : expiresAt
}

function publicLink() {
  return note.value ? `${window.location.origin}/public/${note.value.id}` : ''
}

function shareExpiryLabel(timestamp: number | null) {
  if (!timestamp) return 'Shared indefinitely'
  const days = Math.max(0, differenceInCalendarDays(new Date(timestamp), new Date()))
  const weeks = Math.floor(days / 7)
  return `Expires in ${weeks} ${weeks === 1 ? 'week' : 'weeks'} and ${days % 7} ${days % 7 === 1 ? 'day' : 'days'}`
}

async function copyPublicLink() {
  const url = publicLink()
  if (!url) return
  await navigator.clipboard.writeText(url)
  toast.add({ title: 'Link copied', icon: 'i-lucide-clipboard-check', duration: 2000 })
}

async function saveSharing(isPublic: boolean) {
  if (!noteId.value) return
  const publicUntil = isPublic ? getShareExpiry() : null
  if (publicUntil && publicUntil <= Date.now()) {
    toast.add({ title: 'Choose a future end date', icon: 'i-lucide-calendar-x', color: 'error', duration: 3000 })
    return
  }
  sharing.value = true
  try {
    const updated = await updateSharing(noteId.value, isPublic, publicUntil)
    shareEndDate.value = formatShareEndDate(updated.publicUntil)
    toast.add({
      title: updated.isPublic ? 'Note is shared' : 'Sharing stopped',
      description: updated.isPublic && updated.publicUntil ? `Available through ${formatShareEndDate(updated.publicUntil)}` : undefined,
      icon: updated.isPublic ? 'i-lucide-globe' : 'i-lucide-lock',
      duration: 2500
    })
  } catch {
    toast.add({ title: 'Could not update sharing', icon: 'i-lucide-alert-triangle', color: 'error', duration: 3000 })
  } finally {
    sharing.value = false
  }
}

// ─── Image upload ────────────────────────────────────────────

async function uploadImage(file: File): Promise<string | null> {
  const id = noteId.value
  if (!id) return null
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await $fetch<{ url: string }>(`/api/notes/${id}/attachments`, { method: 'POST', body: form })
    return res.url
  } catch {
    toast.add({ title: 'Image upload failed', icon: 'i-lucide-image-off', color: 'error', duration: 3000 })
    return null
  }
}

// ─── Content & auto-save ─────────────────────────────────────

const editorContent = ref('')
let saveTimer: ReturnType<typeof setTimeout> | null = null
const isDirty = ref(false)
let suppressSave = false

function scheduleAutoSave(html: string) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const id = noteId.value
    if (id) {
      updateNote(id, html)
      isDirty.value = false
    }
  }, 600)
}

function flushSave(id?: string) {
  const targetId = id ?? noteId.value
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (targetId && isDirty.value) {
    updateNote(targetId, editorContent.value)
    isDirty.value = false
  }
}

watch(editorContent, (html) => {
  if (suppressSave) return
  isDirty.value = true
  scheduleAutoSave(html)
})

watch(noteId, async (newId, oldId) => {
  if (oldId) flushSave(oldId)
  suppressSave = true
  editorContent.value = note.value?.content ?? ''
  await nextTick()
  suppressSave = false
  isDirty.value = false
  shareEndDate.value = formatShareEndDate(note.value?.publicUntil ?? null)
  if (newId && autoFocus.value) {
    autoFocus.value = false
    editorRef.value?.focusEditor()
  }
}, { immediate: true })

// Pull in changes made to this note elsewhere (edits by the AI chat). Skipped
// while the user has unsaved keystrokes so a background write can never
// clobber what is being typed.
watch(() => note.value?.content, (content) => {
  if (content === undefined || isDirty.value || saveTimer) return
  if (content === editorContent.value) return
  suppressSave = true
  editorContent.value = content
  nextTick(() => {
    suppressSave = false
  })
})

onBeforeUnmount(() => {
  flushSave()
})

// ─── Copy to Markdown ────────────────────────────────────────

function copyToMarkdown() {
  navigator.clipboard.writeText(htmlToMarkdown(editorContent.value)).then(() => {
    toast.add({ title: 'Copied as Markdown', icon: 'i-lucide-clipboard-check', duration: 2000 })
  })
}

const tagCount = computed(() => note.value?.tags.length ?? 0)
</script>

<template>
  <div class="flex flex-col h-full bg-default">
    <!-- Empty state -->
    <template v-if="!note">
      <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <UIcon
          name="i-lucide-notebook-pen"
          class="size-12 text-muted"
        />
        <p class="text-muted text-sm">
          Select a note or create a new one
        </p>
        <UButton
          icon="i-lucide-plus"
          label="New note"
          color="primary"
          variant="soft"
          size="sm"
          @click="createNote()"
        />
      </div>
    </template>

    <template v-else>
      <RichEditor
        ref="editorRef"
        v-model="editorContent"
        :upload-image="uploadImage"
        class="min-h-0 flex-1 pb-14 lg:pb-0"
      >
        <template #toolbar-right>
          <span
            v-if="tagCount > 0"
            class="flex items-center gap-1 text-xs text-muted"
          >
            <UIcon
              name="i-lucide-tag"
              class="size-3"
            />
            {{ tagCount }}
          </span>
          <div class="w-px h-4 bg-muted/40" />
          <UPopover
            v-model:open="shareOpen"
            :content="{ align: 'end', sideOffset: 8 }"
            @open-auto-focus.prevent
          >
            <UButton
              :icon="note?.isPublic ? 'i-lucide-globe' : 'i-lucide-share-2'"
              size="xs"
              :color="note?.isPublic ? 'primary' : 'neutral'"
              variant="ghost"
              aria-label="Share note"
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
                      Share this note
                    </p>
                    <p class="text-xs text-muted">
                      {{ note?.isPublic ? 'Anyone with the link can view it.' : 'Create a view-only public link.' }}
                    </p>
                  </div>
                </div>

                <UFormField
                  label="End date"
                  hint="Optional"
                >
                  <UInput
                    v-model="shareEndDate"
                    type="date"
                    :min="new Date().toISOString().slice(0, 10)"
                    class="w-full"
                  />
                  <template #hint>
                    <span class="text-xs text-muted">Leave empty to share indefinitely</span>
                  </template>
                </UFormField>

                <div
                  v-if="note?.isPublic"
                  class="rounded-md bg-elevated px-2.5 py-2"
                >
                  <p class="text-xs font-medium text-default">
                    Link is active
                  </p>
                  <p class="mt-0.5 text-xs text-muted truncate">
                    {{ publicLink() }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    {{ shareExpiryLabel(note?.publicUntil ?? null) }}
                  </p>
                </div>

                <div class="flex gap-2">
                  <UButton
                    :label="note?.isPublic ? 'Save changes' : 'Share note'"
                    icon="i-lucide-send"
                    size="sm"
                    class="flex-1 justify-center"
                    :loading="sharing"
                    @click="saveSharing(true)"
                  />
                  <UButton
                    v-if="note?.isPublic"
                    label="Copy link"
                    icon="i-lucide-copy"
                    size="sm"
                    color="neutral"
                    variant="soft"
                    @click="copyPublicLink"
                  />
                </div>

                <UButton
                  v-if="note?.isPublic"
                  label="Stop sharing"
                  icon="i-lucide-lock"
                  size="sm"
                  color="error"
                  variant="ghost"
                  block
                  :loading="sharing"
                  @click="saveSharing(false)"
                />
              </div>
            </template>
          </UPopover>
          <div class="w-px h-4 bg-muted/40" />
          <UButton
            icon="i-lucide-clipboard-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="copyToMarkdown"
          >
            <span class="hidden sm:inline">Copy</span>
          </UButton>
        </template>
      </RichEditor>
    </template>
  </div>
</template>
