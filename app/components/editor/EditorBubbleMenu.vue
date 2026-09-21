<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { CellSelection } from '@tiptap/pm/tables'
import EditorHighlightPicker from '~/components/editor/EditorHighlightPicker.vue'
import { MARK_ITEMS, MOD, SHIFT, TURN_INTO_ITEMS, asButton, type EditorItem, type UiEditor } from '~/utils/editor/items'

// The bubble that follows the selection. It has three faces:
//  - over selected text, the formatting toolbar;
//  - with the caret resting in a link, that link: open, edit, copy, remove;
//  - while a link is being edited, the URL field.
// The URL field lives inside the bubble rather than in a popover of its own:
// the bubble hides when focus leaves the editor for anywhere but itself.
const props = defineProps<{
  editor: UiEditor
  aiItems: EditorItem[]
  aiLoading: boolean
}>()

const PLUGIN_KEY = 'richEditorBubble'

const toast = useToast()

const linkEditing = ref(false)
const linkDraft = ref('')
const linkInput = ref<HTMLInputElement | null>(null)

const activeHref = computed(() => (props.editor.getAttributes('link').href as string | undefined) ?? '')
const linkViewing = computed(() => !linkEditing.value && props.editor.state.selection.empty && props.editor.isActive('link'))

function shouldShow({ editor, view, state }: { editor: Editor, view: EditorView, state: EditorState }) {
  if (!editor.isEditable) return false
  if (linkEditing.value) return true
  if (!view.hasFocus()) return false

  const { selection } = state
  if (selection.empty) return editor.isActive('link')
  // A selected block, a run of table cells and an image have menus of their own.
  if (selection instanceof NodeSelection || selection instanceof CellSelection) return false
  if (editor.isActive('image') || editor.isActive('codeBlock')) return false
  return state.doc.textBetween(selection.from, selection.to).length > 0
}

// The bubble keeps inside the editor's own scroll area and clear of the sticky
// toolbar at its top: on the first lines it flips below the selection instead
// of covering the toolbar.
const floating = computed(() => {
  const boundary = props.editor.view.dom.closest('.rich-editor') ?? undefined
  const padding = { top: 56, right: 8, bottom: 8, left: 8 }
  return { offset: 8, shift: { padding, boundary }, flip: { padding, boundary } }
})

function signal(meta: 'show' | 'hide' | 'updatePosition') {
  if (props.editor.isDestroyed) return
  props.editor.view.dispatch(props.editor.state.tr.setMeta(PLUGIN_KEY, meta))
}

// ─── Link editing ─────────────────────────────────────────────

function editLink(): boolean {
  const ed = props.editor
  if (!ed.isEditable) return false
  const inLink = ed.isActive('link')
  if (ed.state.selection.empty && !inLink) return false
  // Editing a link means editing all of it, wherever the caret was in it.
  if (inLink) ed.chain().extendMarkRange('link').run()

  linkDraft.value = inLink ? activeHref.value : ''
  linkEditing.value = true
  signal('show')
  nextTick(() => {
    signal('updatePosition')
    linkInput.value?.focus()
    linkInput.value?.select()
  })
  return true
}

function normalizeHref(value: string): string {
  const href = value.trim()
  if (!href || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`
  return `https://${href}`
}

function applyLink() {
  const href = normalizeHref(linkDraft.value)
  linkEditing.value = false
  const chain = props.editor.chain().focus()
  if (href) chain.setLink({ href }).run()
  else chain.unsetLink().run()
}

function cancelLink() {
  linkEditing.value = false
  props.editor.commands.focus()
}

function removeLink() {
  linkEditing.value = false
  props.editor.chain().focus().extendMarkRange('link').unsetLink().run()
}

// Focus gone to something outside the bubble: the edit is abandoned.
function onLinkBlur(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  const bubble = (event.currentTarget as HTMLElement).closest('[data-editor-bubble]')
  if (next && bubble?.contains(next)) return
  if (!linkEditing.value) return
  linkEditing.value = false
  if (next !== props.editor.view.dom) signal('hide')
}

async function copyLink() {
  await navigator.clipboard.writeText(activeHref.value)
  toast.add({ title: 'Link copied', icon: 'i-lucide-check', duration: 1500 })
}

// A click back into the text ends an edit that was left open.
function onEditorFocus() {
  linkEditing.value = false
}

onMounted(() => props.editor.on('focus', onEditorFocus))
onBeforeUnmount(() => props.editor.off('focus', onEditorFocus))

defineExpose({ editLink })

// ─── Formatting toolbar ───────────────────────────────────────

const items = computed<EditorItem[][]>(() => [[
  {
    'icon': 'i-lucide-type',
    'trailingIcon': 'i-lucide-chevron-down',
    'aria-label': 'Turn into',
    'tooltip': { text: 'Turn into' },
    'ui': { trailingIcon: 'size-3.5 text-dimmed' },
    'content': { align: 'start' },
    'items': TURN_INTO_ITEMS
  }
], [
  ...MARK_ITEMS.map(asButton),
  { slot: 'highlight' },
  { slot: 'link' }
], [
  {
    'icon': 'i-lucide-sparkles',
    'label': 'AI',
    'aria-label': 'AI',
    'color': 'primary',
    'loading': props.aiLoading,
    'content': { align: 'end' },
    'items': props.aiItems
  }
]])
</script>

<template>
  <BubbleMenu
    :editor="editor"
    :plugin-key="PLUGIN_KEY"
    :should-show="shouldShow"
    :update-delay="80"
    :options="floating"
    class="z-50 focus:outline-none"
    tabindex="-1"
  >
    <div
      data-editor-bubble
      class="editor-bubble"
    >
      <!-- Link being edited -->
      <form
        v-if="linkEditing"
        class="flex items-center gap-1"
        @submit.prevent="applyLink"
      >
        <UIcon
          name="i-lucide-link"
          class="ml-1.5 size-4 shrink-0 text-dimmed"
        />
        <input
          ref="linkInput"
          v-model="linkDraft"
          type="text"
          inputmode="url"
          placeholder="Paste or type a link…"
          aria-label="Link URL"
          class="h-7 w-64 max-w-[60vw] bg-transparent px-1 text-sm text-default outline-none placeholder:text-dimmed"
          @keydown.esc.stop.prevent="cancelLink"
          @blur="onLinkBlur"
        >
        <UButton
          type="submit"
          icon="i-lucide-check"
          size="sm"
          color="primary"
          variant="soft"
          aria-label="Apply link"
        />
        <UButton
          v-if="activeHref"
          icon="i-lucide-unlink"
          size="sm"
          color="neutral"
          variant="ghost"
          aria-label="Remove link"
          @click="removeLink"
        />
      </form>

      <!-- Caret resting in a link -->
      <div
        v-else-if="linkViewing"
        class="flex items-center gap-0.5"
      >
        <a
          :href="activeHref"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
        >
          <UIcon
            name="i-lucide-external-link"
            class="size-3.5 shrink-0"
          />
          <span class="max-w-56 truncate">{{ activeHref }}</span>
        </a>
        <div class="mx-0.5 h-5 w-px bg-border" />
        <UTooltip text="Edit link">
          <UButton
            icon="i-lucide-pencil"
            size="sm"
            color="neutral"
            variant="ghost"
            aria-label="Edit link"
            @click="editLink()"
          />
        </UTooltip>
        <UTooltip text="Copy link">
          <UButton
            icon="i-lucide-copy"
            size="sm"
            color="neutral"
            variant="ghost"
            aria-label="Copy link"
            @click="copyLink"
          />
        </UTooltip>
        <UTooltip text="Remove link">
          <UButton
            icon="i-lucide-unlink"
            size="sm"
            color="neutral"
            variant="ghost"
            aria-label="Remove link"
            @click="removeLink"
          />
        </UTooltip>
      </div>

      <!-- Selected text -->
      <UEditorToolbar
        v-else
        :editor="editor"
        :items="items"
      >
        <template #highlight>
          <EditorHighlightPicker :editor="editor" />
        </template>

        <template #link>
          <UTooltip
            text="Link"
            :kbds="[MOD, SHIFT, 'K']"
          >
            <UButton
              icon="i-lucide-link"
              size="sm"
              color="neutral"
              variant="ghost"
              active-color="primary"
              active-variant="soft"
              :active="editor.isActive('link')"
              aria-label="Link"
              @click="editLink()"
            />
          </UTooltip>
        </template>
      </UEditorToolbar>
    </div>
  </BubbleMenu>
</template>
