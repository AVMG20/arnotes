<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { parseChart, renderChart, ChartParseError, type ChartLegendEntry } from '~/utils/chart'
import { renderMermaid, describeMermaidError } from '~/utils/mermaid'

// The picture drawn from a `chart` or `mermaid` code block. Charts are drawn
// synchronously from the block text; Mermaid is loaded on demand and drawn
// after a short pause so typing does not redraw on every keystroke. Both
// keep the last good drawing on screen while the text is mid-edit, and show
// the error under it instead of blanking the block.
const props = defineProps<{
  language: 'chart' | 'mermaid'
  code: string
}>()

const colorMode = useColorMode()
const dark = computed(() => colorMode.value === 'dark')

const svg = ref('')
const legend = ref<ChartLegendEntry[]>([])
const error = ref('')
const pending = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null
let run = 0

function drawChart() {
  try {
    const rendered = renderChart(parseChart(props.code))
    svg.value = rendered.svg
    legend.value = rendered.legend
    error.value = ''
  } catch (e) {
    error.value = e instanceof ChartParseError ? e.message : 'Could not draw this chart.'
    if (!svg.value) legend.value = []
  }
}

async function drawMermaid() {
  const id = ++run
  pending.value = true
  try {
    const out = await renderMermaid(props.code, dark.value)
    if (id !== run) return
    svg.value = out
    error.value = ''
  } catch (e) {
    if (id !== run) return
    error.value = describeMermaidError(e)
  } finally {
    if (id === run) pending.value = false
  }
}

function schedule(immediate = false) {
  if (timer) clearTimeout(timer)
  if (!props.code.trim()) {
    svg.value = ''
    legend.value = []
    error.value = ''
    return
  }
  if (props.language === 'chart') {
    drawChart()
    return
  }
  timer = setTimeout(drawMermaid, immediate ? 0 : 350)
}

watch(() => [props.code, props.language], () => schedule(), { immediate: true })
watch(dark, () => schedule(true))

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

// ─── Hover tooltip ───────────────────────────────────────────
// Every mark carries its series, label and value as data attributes; the
// tooltip is one element positioned above the pointer inside the preview.

const root = ref<HTMLElement | null>(null)
const tooltip = ref<{ x: number, y: number, below: boolean, series: number, label: string, value: string } | null>(null)

function onCanvasMove(event: MouseEvent) {
  const mark = (event.target as Element | null)?.closest?.('[data-label]') as HTMLElement | null
  if (!mark || !root.value) {
    tooltip.value = null
    return
  }
  const box = root.value.getBoundingClientRect()
  const margin = 60
  const y = event.clientY - box.top
  tooltip.value = {
    x: Math.min(Math.max(event.clientX - box.left, margin), box.width - margin),
    y,
    // The block clips its overflow, so near the top edge the tooltip drops below the pointer.
    below: y < 48,
    series: Number(mark.dataset.series ?? 0),
    label: mark.dataset.label ?? '',
    value: mark.dataset.value ?? ''
  }
}

function onCanvasLeave() {
  tooltip.value = null
}
</script>

<template>
  <div
    ref="root"
    class="diagram-preview"
    :class="{ 'diagram-preview--stale': error && svg }"
  >
    <div
      v-if="svg"
      class="diagram-preview-canvas"
      @mousemove="onCanvasMove"
      @mouseleave="onCanvasLeave"
      v-html="svg"
    />
    <p
      v-else-if="!error"
      class="diagram-preview-empty"
    >
      {{ pending ? 'Drawing…' : (language === 'chart' ? 'Add a series, like "Sales: 12, 19, 7".' : 'Write a Mermaid diagram to see it here.') }}
    </p>

    <div
      v-if="tooltip"
      class="chart-tooltip"
      :class="{ 'chart-tooltip--below': tooltip.below }"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <i :style="{ background: `var(--chart-${tooltip.series + 1})` }" />{{ tooltip.label }}: <b>{{ tooltip.value }}</b>
    </div>

    <ul
      v-if="legend.length"
      class="diagram-preview-legend"
    >
      <li
        v-for="entry in legend"
        :key="entry.label"
      >
        <i :style="{ background: `var(--chart-${entry.colorIndex + 1})` }" />
        <span>{{ entry.label }}</span>
        <span
          v-if="entry.value"
          class="diagram-preview-legend-value"
        >{{ entry.value }}</span>
      </li>
    </ul>

    <p
      v-if="error"
      class="diagram-preview-error"
    >
      <UIcon
        name="i-lucide-alert-triangle"
        class="size-3.5 shrink-0"
      />
      <span>{{ error }}</span>
    </p>
  </div>
</template>
