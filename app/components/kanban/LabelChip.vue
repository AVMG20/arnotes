<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import type { FunctionalComponent } from 'vue'
import { tagChipAttrs } from '~/utils/tagColors'
import { boardLabelColor } from '~/composables/useProjects'
import { ACCENT_COLORS, colorHex } from '#shared/utils/colors'

// One label, wherever it appears: a card, the task panel, the board's filter.
// Right-clicking it picks a colour for that label across the whole board.
//
// A label is not a row anywhere — it is a string on a task — so there is nothing
// to open a settings panel for, and nowhere to hang a menu button without
// putting a second control on every chip. A context menu is the one affordance
// that costs no space until it is used.
const props = withDefaults(defineProps<{
  tag: string
  /** Off where the board is read-only, which disables the menu. */
  editable?: boolean
  /** Shows the remove affordance the task panel's chips carry. */
  removable?: boolean
  /** Sizing and layout stay with the caller; the colours come from here. */
  chipClass?: string
}>(), { editable: false, removable: false, chipClass: '' })

const emit = defineEmits<{ select: [tag: string], remove: [tag: string] }>()

// A removable chip owns its click and keeps it: on the task panel the X is the
// point. Everywhere else the click belongs to whatever the chip sits inside —
// a card that opens the task, a filter row that toggles the label — so it is
// left to bubble, and only the right-click is ours.
function onClick(event: MouseEvent) {
  if (!props.removable) {
    emit('select', props.tag)
    return
  }
  event.stopPropagation()
  emit('remove', props.tag)
}

// A board draws a chip for every label on every card, and a context menu apiece
// is most of what each one costs to build. The chip starts as the bare label;
// the first right-click mounts the menu and hands it that same click, and from
// then on the chip keeps it.
const ContextMenu = resolveComponent('UContextMenu')
const Bare: FunctionalComponent = (_, { slots }) => slots.default?.()
Bare.inheritAttrs = false

const menuMounted = ref(false)
const chipEl = ref<HTMLElement | null>(null)

async function onContextMenu(event: MouseEvent) {
  if (!props.editable || menuMounted.value) return
  event.preventDefault()
  menuMounted.value = true
  await nextTick()
  chipEl.value?.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY
  }))
}

function setLabelColor(tag: string, color: string | null) {
  return useProjects().setLabelColor(tag, color)
}

const pinned = computed(() => boardLabelColor(props.tag))
const attrs = computed(() => tagChipAttrs(props.tag, pinned.value))

const items = computed<ContextMenuItem[][]>(() => {
  if (!menuMounted.value) return []
  return [
    [{ label: props.tag, type: 'label' as const }],
    [{
      label: 'Automatic',
      icon: 'i-lucide-wand-2',
      type: 'checkbox' as const,
      checked: !pinned.value,
      onSelect: () => { if (pinned.value) setLabelColor(props.tag, null) }
    }],
    ACCENT_COLORS.map(color => ({
      label: color[0]!.toUpperCase() + color.slice(1),
      type: 'checkbox' as const,
      checked: pinned.value === color,
      // The swatch is an inline style, so it goes through a named slot rather
      // than the item's `icon` — Tailwind has no class for a runtime colour.
      slot: 'color' as const,
      hex: colorHex(color),
      onSelect: () => setLabelColor(props.tag, color)
    }))
  ]
})
</script>

<template>
  <component
    :is="menuMounted ? ContextMenu : Bare"
    :items="items"
    :disabled="!editable"
  >
    <span
      ref="chipEl"
      class="group flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 font-medium ring-1 ring-inset"
      :class="[attrs.class, chipClass, removable ? 'cursor-pointer' : '']"
      :style="attrs.style"
      :title="editable ? `${tag} — right-click to change colour` : tag"
      @click="onClick"
      @contextmenu="onContextMenu"
    >
      <span class="truncate">{{ tag }}</span>
      <UIcon
        v-if="removable"
        name="i-lucide-x"
        class="size-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
      />
    </span>

    <template #color-leading="{ item }">
      <span
        class="size-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
        :style="{ backgroundColor: (item as { hex: string }).hex }"
      />
    </template>
  </component>
</template>
