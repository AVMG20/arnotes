<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { htmlToMarkdown } from '~/utils/markdown'

const { activeNoteId, autoFocus, getNote, createNote, updateNote, updateSharing } = useNotes()
const toast = useToast()

const noteId = computed(() => activeNoteId.value)
const note = computed(() => getNote(noteId.value))

const editorRef = ref()

const publicLink = computed(() =>
  note.value && import.meta.client ? `${window.location.origin}/public/${note.value.id}` : ''
)

function saveSharing(isPublic: boolean, publicUntil: number | null) {
  return updateSharing(noteId.value!, isPublic, publicUntil)
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
          <SharePopover
            subject="note"
            :is-public="note?.isPublic ?? false"
            :public-until="note?.publicUntil ?? null"
            :link="publicLink"
            :save="saveSharing"
          />
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
