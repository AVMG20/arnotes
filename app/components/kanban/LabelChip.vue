<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { tagChipAttrs } from '~/utils/tagColors'
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

const { labelColor, setLabelColor } = useProjects()

const pinned = computed(() => labelColor(props.tag))
const attrs = computed(() => tagChipAttrs(props.tag, pinned.value))

const items = computed<ContextMenuItem[][]>(() => [
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
])
</script>

<template>
  <UContextMenu
    :items="items"
    :disabled="!editable"
  >
    <span
      class="group flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 font-medium ring-1 ring-inset"
      :class="[attrs.class, chipClass, removable ? 'cursor-pointer' : '']"
      :style="attrs.style"
      :title="editable ? `${tag} — right-click to change colour` : tag"
      @click="onClick"
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
  </UContextMenu>
</template>
