<script setup lang="ts">
import { ref } from 'vue'

// The "Ask AI" dialog: a free-form prompt whose result is written at the caret.
// The prompt is kept until a generation succeeds, so a failed request can be
// retried without retyping it.
const props = defineProps<{
  generate: (instruction: string, includeContext: boolean) => Promise<boolean>
}>()

const open = defineModel<boolean>('open', { required: true })

const prompt = ref('')
const includeContext = ref(true)

async function submit() {
  const instruction = prompt.value.trim()
  if (!instruction) return
  if (await props.generate(instruction, includeContext.value)) prompt.value = ''
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Ask AI"
    description="Describe what you want to add at the current cursor position. You can optionally include the current content as context."
    :ui="{ footer: 'justify-between' }"
  >
    <template #body>
      <form
        id="ai-prompt-form"
        class="space-y-3"
        @submit.prevent="submit"
      >
        <UTextarea
          v-model="prompt"
          autofocus
          autoresize
          :rows="4"
          :maxrows="10"
          placeholder="For example: Create a Drizzle schema for roles and permissions with a short usage example"
          class="w-full"
          @keydown.meta.enter.prevent="submit"
          @keydown.ctrl.enter.prevent="submit"
        />
        <div class="flex items-center justify-between gap-4">
          <UCheckbox
            v-model="includeContext"
            label="Include current content as context"
          />
          <p class="text-xs text-muted text-right">
            Markdown, tables, task lists, code blocks, Mermaid and charts are supported.
          </p>
        </div>
      </form>
    </template>

    <template #footer="{ close }">
      <span class="text-xs text-muted">Cmd/Ctrl + Enter to generate</span>
      <div class="flex items-center gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="close"
        />
        <UButton
          type="submit"
          form="ai-prompt-form"
          label="Generate"
          icon="i-lucide-sparkles"
          :disabled="!prompt.trim()"
        />
      </div>
    </template>
  </UModal>
</template>
