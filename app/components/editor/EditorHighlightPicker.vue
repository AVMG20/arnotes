<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiEditor } from '~/utils/editor/items'
import { HIGHLIGHT_COLORS, type HighlightColor } from '~/utils/editor/extensions'

// The highlighter: a button that opens a row of colours. The default yellow is
// stored as a bare `<mark>`, which is also what `==text==` types.
const props = defineProps<{ editor: UiEditor }>()

const open = ref(false)

const current = computed<HighlightColor | null>(() => {
  if (!props.editor.isActive('highlight')) return null
  return (props.editor.getAttributes('highlight').color as HighlightColor | null) ?? 'yellow'
})

const disabled = computed(() => !props.editor.isEditable || !props.editor.can().toggleHighlight())

function pick(color: HighlightColor) {
  open.value = false
  const chain = props.editor.chain().focus()
  if (current.value === color) chain.unsetHighlight().run()
  // The colour is always passed, even as none: marks merge with what was there.
  else chain.setHighlight({ color: (color === 'yellow' ? null : color) as string }).run()
}

function clear() {
  open.value = false
  props.editor.chain().focus().unsetHighlight().run()
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'center', sideOffset: 8 }"
  >
    <UTooltip
      text="Highlight"
      :disabled="open"
    >
      <UButton
        icon="i-lucide-highlighter"
        size="sm"
        color="neutral"
        variant="ghost"
        active-color="primary"
        active-variant="soft"
        :active="!!current"
        :disabled="disabled"
        aria-label="Highlight"
      />
    </UTooltip>

    <template #content>
      <div class="flex items-center gap-1 p-1.5">
        <!-- `mousedown.prevent` keeps the selection in the editor alive. -->
        <button
          v-for="color in HIGHLIGHT_COLORS"
          :key="color.id"
          type="button"
          class="editor-swatch"
          :class="{ 'editor-swatch-active': current === color.id }"
          :style="{ backgroundColor: `var(--hl-${color.id})` }"
          :aria-label="`${color.label} highlight`"
          :title="color.label"
          @mousedown.prevent
          @click="pick(color.id)"
        />
        <div class="mx-0.5 h-5 w-px bg-border" />
        <UButton
          icon="i-lucide-eraser"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="!current"
          aria-label="Remove highlight"
          @mousedown.prevent
          @click="clear"
        />
      </div>
    </template>
  </UPopover>
</template>
