<script setup lang="ts">
const props = withDefaults(defineProps<{
  maxRows?: number
  maxCols?: number
}>(), {
  maxRows: 8,
  maxCols: 10
})

const emit = defineEmits<{
  select: [size: { rows: number, cols: number }]
}>()

const hoverRows = ref(0)
const hoverCols = ref(0)

function cellRow(index: number) {
  return Math.ceil(index / props.maxCols)
}

function cellCol(index: number) {
  return ((index - 1) % props.maxCols) + 1
}

function enterCell(index: number) {
  hoverRows.value = cellRow(index)
  hoverCols.value = cellCol(index)
}

function leave() {
  hoverRows.value = 0
  hoverCols.value = 0
}

function select() {
  if (!hoverRows.value || !hoverCols.value) return
  emit('select', { rows: hoverRows.value, cols: hoverCols.value })
}
</script>

<template>
  <div
    class="p-2.5 select-none"
    @mouseleave="leave"
  >
    <div
      class="grid gap-0.5"
      :style="{ gridTemplateColumns: `repeat(${maxCols}, minmax(0, 1fr))` }"
    >
      <button
        v-for="index in maxRows * maxCols"
        :key="index"
        type="button"
        tabindex="-1"
        class="size-5 rounded-[3px] border cursor-pointer transition-colors"
        :class="cellRow(index) <= hoverRows && cellCol(index) <= hoverCols
          ? (cellRow(index) === 1
            ? 'bg-primary/70 border-primary/70'
            : 'bg-primary/15 border-primary/40')
          : 'bg-elevated border-default hover:border-primary/40'"
        :aria-label="`${cellRow(index)} rows, ${cellCol(index)} columns`"
        @mouseenter="enterCell(index)"
        @click="select"
      />
    </div>
    <p class="pt-2 pb-0.5 text-center text-xs text-muted tabular-nums">
      {{ hoverRows ? `${hoverRows} × ${hoverCols}` : 'Choose table size' }}
    </p>
  </div>
</template>
