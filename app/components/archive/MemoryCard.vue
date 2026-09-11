<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'

// One stored memory, drawn live from the row cache and editable where it sits.
//
// The point of editing here is speed: when the assistant has written something
// slightly wrong, correcting the line is faster and more certain than asking it
// to try again. Nothing here calls the model — the assistant reads storage fresh
// on its next turn, so it sees the correction without being told.
const props = defineProps<{ memoryId: string }>()

const { memories, saveMemory, forgetMemory, adoptConflict } = useArchive()
const toast = useToast()

const memory = computed(() => memories.value[props.memoryId])

const editing = ref(false)
const draft = ref('')
const titleDraft = ref('')
const saving = ref(false)
const conflicted = ref(false)
const bodyEl = ref<HTMLTextAreaElement | null>(null)

const updatedLabel = computed(() => {
  if (!memory.value) return ''
  return new Date(memory.value.updatedAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  })
})

function autoGrow() {
  const el = bodyEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function startEditing() {
  if (!memory.value || memory.value.deletedAt) return
  draft.value = memory.value.body
  titleDraft.value = memory.value.title
  editing.value = true
  conflicted.value = false
  nextTick(() => {
    bodyEl.value?.focus()
    autoGrow()
  })
}

function cancel() {
  editing.value = false
  conflicted.value = false
}

async function commit() {
  const row = memory.value
  if (!row || saving.value) return

  const title = titleDraft.value.trim() || row.title
  if (draft.value === row.body && title === row.title) {
    editing.value = false
    return
  }

  saving.value = true
  try {
    await saveMemory(props.memoryId, { title, body: draft.value })
    editing.value = false
    conflicted.value = false
  } catch (error) {
    // 409: the assistant rewrote this row while the card was open. The stored
    // version replaces what is drawn, and the draft stays in the box so nothing
    // the user typed is lost to it.
    const conflict = (error as { data?: { data?: { memory?: typeof row } } })?.data?.data?.memory
    if (conflict) {
      adoptConflict('memory', conflict)
      conflicted.value = true
    } else {
      toast.add({ title: 'Could not save that change', color: 'error' })
    }
  } finally {
    saving.value = false
  }
}

async function forget() {
  try {
    await forgetMemory(props.memoryId)
  } catch {
    toast.add({ title: 'Could not forget that memory', color: 'error' })
  }
}

watch(() => memory.value?.id, () => {
  editing.value = false
  conflicted.value = false
})
</script>

<template>
  <!-- A card whose row is gone says so rather than disappearing: the reply that
       pointed at it is still on screen, and a silent gap reads as a bug. -->
  <div
    v-if="!memory"
    class="rounded-xl border border-dashed border-default px-3 py-2 text-xs text-dimmed"
  >
    This memory is no longer stored.
  </div>

  <div
    v-else-if="memory.deletedAt"
    class="rounded-xl border border-dashed border-default px-3 py-2 text-xs text-dimmed"
  >
    <span class="line-through">{{ memory.title }}</span> — forgotten
  </div>

  <div
    v-else
    class="overflow-hidden rounded-xl border border-default bg-elevated/30"
  >
    <div class="flex items-start gap-2 border-b border-default px-3 py-2">
      <UIcon
        name="i-lucide-brain"
        class="mt-0.5 size-4 shrink-0 text-primary"
      />

      <input
        v-if="editing"
        v-model="titleDraft"
        class="min-w-0 flex-1 bg-transparent text-sm font-medium text-default outline-none"
        aria-label="Memory title"
        @keydown.enter.prevent="commit"
        @keydown.esc="cancel"
      >
      <button
        v-else
        class="min-w-0 flex-1 cursor-text truncate text-left text-sm font-medium text-default"
        @click="startEditing"
      >
        {{ memory.title }}
      </button>

      <span class="shrink-0 text-xs text-dimmed">{{ updatedLabel }}</span>

      <UButton
        v-if="!editing"
        icon="i-lucide-pencil-line"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Edit memory"
        @click="startEditing"
      />
      <UButton
        v-if="!editing"
        icon="i-lucide-trash-2"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Forget memory"
        @click="forget"
      />
    </div>

    <div class="px-3 py-2">
      <textarea
        v-if="editing"
        ref="bodyEl"
        v-model="draft"
        class="w-full resize-none bg-transparent font-mono text-xs leading-relaxed text-default outline-none"
        rows="3"
        aria-label="Memory body"
        @input="autoGrow"
        @keydown.esc="cancel"
      />
      <div
        v-else-if="memory.body.trim()"
        class="markdown-content cursor-text text-sm"
        @click="startEditing"
        v-html="renderChatMarkdown(memory.body)"
      />
      <button
        v-else
        class="text-xs text-dimmed"
        @click="startEditing"
      >
        Empty — click to write something.
      </button>

      <div
        v-if="memory.tags.length && !editing"
        class="mt-2 flex flex-wrap gap-1"
      >
        <span
          v-for="tag in memory.tags"
          :key="tag"
          class="rounded bg-elevated px-1.5 py-0.5 text-xs text-muted"
        >#{{ tag }}</span>
      </div>
    </div>

    <div
      v-if="editing"
      class="flex items-center gap-2 border-t border-default px-3 py-2"
    >
      <UButton
        size="xs"
        color="primary"
        :loading="saving"
        @click="commit"
      >
        Save
      </UButton>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        @click="cancel"
      >
        Cancel
      </UButton>
      <p
        v-if="conflicted"
        class="text-xs text-warning"
      >
        The assistant changed this too — the card now shows what is stored. Save again to keep your version.
      </p>
      <p
        v-else
        class="text-xs text-dimmed"
      >
        Markdown. Esc to cancel.
      </p>
    </div>
  </div>
</template>
