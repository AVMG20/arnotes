<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JSONContent } from '@tiptap/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import { mapEditorItems } from '@nuxt/ui/utils/editor'
import { LIST_ITEMS, TEXT_BLOCKS, blockLabel, blockMarkdown } from '~/utils/editor/blocks'
import { ALT, MOD, SHIFT, TURN_INTO_ITEMS, type UiEditor } from '~/utils/editor/items'

// What appears beside the block under the pointer: a "+" that starts a new
// block below it, and a grip that drags the block, or on a click opens
// everything that can be done to it.
const props = defineProps<{
  editor: UiEditor
  // The editor's custom handlers, so menu items can use the same `kind`s.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: any
}>()

const toast = useToast()

// The handle follows the pointer into lists, so a single item — at any depth —
// can be dragged or opened. Nothing else nested is a target: a paragraph in a
// quote or a table cell moves with the block it is part of. The list as a whole
// gives way to its items; it still moves with a selection across it (Alt+↑/↓).
const nested = {
  edgeDetection: 'none' as const,
  rules: [{
    id: 'onlyListItemsNested',
    evaluate: ({ node, depth }: { node: { type: { name: string } }, depth: number }) =>
      depth > 1 && !LIST_ITEMS.has(node.type.name) ? 1000 : 0
  }]
}

const hovered = ref<{ node: JSONContent, pos: number } | null>(null)
const menuOpen = ref(false)

// While the menu is open the handle must stay on its block, even though the
// pointer has left it for the menu.
function onMenuToggle(open: boolean) {
  menuOpen.value = open
  props.editor.chain().setMeta('lockDragHandle', open).run()
}

async function copyMarkdown(pos: number) {
  await navigator.clipboard.writeText(blockMarkdown(props.editor, pos))
  toast.add({ title: 'Copied as Markdown', icon: 'i-lucide-check', duration: 1500 })
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const target = hovered.value
  if (!target) return []
  const { node, pos } = target

  const groups = [
    [{ type: 'label', label: blockLabel(node) }],
    TEXT_BLOCKS.has(node.type ?? '') || node.type === 'codeBlock'
      ? [
          { label: 'Turn into', icon: 'i-lucide-repeat-2', children: TURN_INTO_ITEMS.map(item => ({ ...item, kbds: undefined })) },
          { kind: 'clearFormatting', pos, label: 'Clear formatting', icon: 'i-lucide-remove-formatting' }
        ]
      : [],
    [
      { kind: 'duplicate', pos, label: 'Duplicate', icon: 'i-lucide-copy-plus', kbds: [MOD, SHIFT, 'D'] },
      { label: 'Copy as Markdown', icon: 'i-lucide-clipboard-copy', onSelect: () => copyMarkdown(pos) }
    ],
    [
      { kind: 'moveUp', pos, label: 'Move up', icon: 'i-lucide-arrow-up', kbds: [ALT, '↑'] },
      { kind: 'moveDown', pos, label: 'Move down', icon: 'i-lucide-arrow-down', kbds: [ALT, '↓'] }
    ],
    [{ kind: 'delete', pos, label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' }]
  ].filter(group => group.length)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mapEditorItems(props.editor as any, groups as any, props.handlers) as DropdownMenuItem[][]
})

// A bullet or number hangs in the margin left of its item, outside the item's
// box; the handle steps further out so it does not sit on top of it.
const floating = {
  offset: ({ rects }: { rects: { reference: { height: number }, floating: { height: number } } }) => {
    const hasMarker = hovered.value?.node.type === 'listItem'
    const tall = rects.reference.height > 40
    return {
      mainAxis: hasMarker ? 24 : 4,
      alignmentAxis: tall ? (hasMarker ? 2 : 0) : (rects.reference.height - rects.floating.height) / 2
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addBelow(event: MouseEvent, select: () => any) {
  event.stopPropagation()
  const selected = select()
  const node = selected ? props.editor.state.doc.nodeAt(selected.pos) : null
  // Below a list item comes another list item, not a loose paragraph.
  if (node && LIST_ITEMS.has(node.type.name)) {
    const at = selected.pos + node.nodeSize
    props.editor.chain().focus().insertContentAt(at, {
      type: node.type.name,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }]
    }).run()
    return
  }
  props.handlers.suggestion?.execute(props.editor, { pos: selected?.pos }).run()
}
</script>

<template>
  <UEditorDragHandle
    v-slot="{ ui, onClick }"
    :editor="editor"
    :nested="nested"
    :options="floating"
    @node-change="hovered = $event"
    @hover="hovered = menuOpen ? hovered : $event"
  >
    <div class="editor-block-handle">
      <UTooltip
        text="Add below"
        :content="{ side: 'top' }"
      >
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="Add a block below"
          @click="addBelow($event, onClick)"
        />
      </UTooltip>

      <UDropdownMenu
        :items="menuItems"
        :modal="false"
        :content="{ side: 'left', align: 'start', sideOffset: 4 }"
        :ui="{ content: 'w-52' }"
        @update:open="onMenuToggle"
      >
        <UButton
          icon="i-lucide-grip-vertical"
          color="neutral"
          variant="ghost"
          active-variant="soft"
          size="xs"
          square
          :active="menuOpen"
          :class="ui.handle()"
          aria-label="Drag to move, click for options"
        />
      </UDropdownMenu>
    </div>
  </UEditorDragHandle>
</template>
