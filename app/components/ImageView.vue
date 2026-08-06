<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)

const MIN_WIDTH = 60

const img = ref<HTMLImageElement | null>(null)
const dragWidth = ref<number | null>(null)
const widthInput = ref('')

const editable = computed(() => props.editor.isEditable)
const active = computed(() => editable.value && props.selected)

const align = computed<'left' | 'center' | 'right'>(() => {
  const value = props.node.attrs.align
  return value === 'center' || value === 'right' ? value : 'left'
})

const storedWidth = computed<number | null>(() => {
  const value = Number(props.node.attrs.width)
  return Number.isFinite(value) && value > 0 ? value : null
})

const displayWidth = computed(() => dragWidth.value ?? storedWidth.value)

const wrapperClass = computed(() => ({
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end'
}[align.value]))

watch([active, displayWidth], () => {
  if (!active.value) return
  const rendered = Math.round(img.value?.getBoundingClientRect().width ?? 0)
  widthInput.value = String(displayWidth.value ?? rendered)
}, { immediate: true })

function maxWidth() {
  // The `.image-node` wrapper is block-level, so it always spans the full
  // width available to the image inside the editor.
  const row = img.value?.closest<HTMLElement>('.image-node')
  return row?.getBoundingClientRect().width || 2000
}

function clamp(value: number) {
  return Math.round(Math.min(Math.max(value, MIN_WIDTH), maxWidth()))
}

function setWidth(value: number | null) {
  props.updateAttributes({ width: value })
}

function setAlign(value: 'left' | 'center' | 'right') {
  props.updateAttributes({ align: value })
}

function applyWidthInput() {
  const parsed = Number.parseInt(widthInput.value, 10)
  if (!Number.isFinite(parsed)) {
    widthInput.value = String(displayWidth.value ?? '')
    return
  }
  const next = clamp(parsed)
  widthInput.value = String(next)
  setWidth(next)
}

function startResize(event: PointerEvent, side: 'left' | 'right') {
  if (!editable.value) return
  event.preventDefault()
  event.stopPropagation()

  const startX = event.clientX
  const startWidth = img.value?.getBoundingClientRect().width ?? MIN_WIDTH

  const onMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX
    dragWidth.value = clamp(side === 'right' ? startWidth + delta : startWidth - delta)
  }

  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (dragWidth.value !== null) setWidth(dragWidth.value)
    dragWidth.value = null
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <NodeViewWrapper
    class="image-node flex my-4"
    :class="wrapperClass"
    :data-align="align"
  >
    <div
      class="image-node__frame relative inline-flex max-w-full"
      :class="{ 'image-node__frame--active': active }"
    >
      <img
        ref="img"
        :src="props.node.attrs.src"
        :alt="props.node.attrs.alt ?? undefined"
        :title="props.node.attrs.title ?? undefined"
        :style="displayWidth ? { width: `${displayWidth}px` } : undefined"
        class="block h-auto max-w-full rounded-md"
        draggable="false"
      >

      <template v-if="active">
        <button
          type="button"
          class="image-node__handle image-node__handle--left"
          aria-label="Resize image"
          @pointerdown="startResize($event, 'left')"
        />
        <button
          type="button"
          class="image-node__handle image-node__handle--right"
          aria-label="Resize image"
          @pointerdown="startResize($event, 'right')"
        />

        <div
          class="image-node__toolbar"
          contenteditable="false"
          @pointerdown.stop
          @mousedown.stop
        >
          <UButton
            icon="i-lucide-align-left"
            size="xs"
            :color="align === 'left' ? 'primary' : 'neutral'"
            :variant="align === 'left' ? 'soft' : 'ghost'"
            aria-label="Align left"
            @click="setAlign('left')"
          />
          <UButton
            icon="i-lucide-align-center"
            size="xs"
            :color="align === 'center' ? 'primary' : 'neutral'"
            :variant="align === 'center' ? 'soft' : 'ghost'"
            aria-label="Align center"
            @click="setAlign('center')"
          />
          <UButton
            icon="i-lucide-align-right"
            size="xs"
            :color="align === 'right' ? 'primary' : 'neutral'"
            :variant="align === 'right' ? 'soft' : 'ghost'"
            aria-label="Align right"
            @click="setAlign('right')"
          />

          <div class="image-node__divider" />

          <input
            v-model="widthInput"
            type="number"
            inputmode="numeric"
            :min="MIN_WIDTH"
            class="image-node__width"
            aria-label="Image width in pixels"
            @keydown.enter.prevent="applyWidthInput"
            @blur="applyWidthInput"
          >
          <span class="image-node__unit">px</span>

          <div class="image-node__divider" />

          <UButton
            icon="i-lucide-rotate-ccw"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Reset size"
            @click="setWidth(null)"
          />
        </div>
      </template>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.image-node__frame--active img {
  outline: 2px solid var(--ui-color-primary-500);
  outline-offset: 2px;
}

.image-node__handle {
  position: absolute;
  top: 50%;
  width: 0.75rem;
  height: 3rem;
  max-height: 60%;
  transform: translateY(-50%);
  background: var(--ui-color-primary-500);
  border: 2px solid var(--ui-bg);
  border-radius: 999px;
  cursor: ew-resize;
  touch-action: none;
}

.image-node__handle--left {
  left: -0.375rem;
}

.image-node__handle--right {
  right: -0.375rem;
}

.image-node__toolbar {
  position: absolute;
  bottom: 0.5rem;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.2rem 0.3rem;
  transform: translateX(-50%);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
}

.image-node__divider {
  width: 1px;
  height: 1rem;
  margin: 0 0.15rem;
  background: var(--ui-border);
}

.image-node__width {
  width: 3.5rem;
  padding: 0.1rem 0.25rem;
  font-size: 0.75rem;
  color: var(--ui-text);
  text-align: right;
  background: transparent;
  border: none;
  outline: none;
}

.image-node__width::-webkit-outer-spin-button,
.image-node__width::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.image-node__unit {
  font-size: 0.7rem;
  color: var(--ui-text-muted);
}
</style>
