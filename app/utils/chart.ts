// A small chart language for notes and task descriptions, and the SVG it draws.
//
// A chart is a fenced code block in the `chart` language, a few lines long:
//
//   type: bar              bar (default), line or pie
//   title: Monthly revenue optional
//   labels: Jan, Feb, Mar  the x axis (bar, line) or the slice names (pie)
//   Revenue: 10, 20, 30    every other line is a series of numbers
//   Costs: 5, 8, 12
//
// A pie with a single series takes its slice names from `labels`; with no
// labels each `Name: value` line is one slice. The block is stored as ordinary
// code, so it survives every Markdown round trip and an agent can write one.
//
// The SVG is built from escaped text and carries no scripts or links, so it is
// safe to inject however the block arrived. Colours are CSS variables, which
// keeps the chart in step with the theme without a re-render.

export type ChartType = 'bar' | 'line' | 'pie'

export interface ChartSeries {
  name: string
  values: number[]
}

export interface ChartSpec {
  type: ChartType
  title: string
  labels: string[]
  series: ChartSeries[]
}

export interface ChartLegendEntry {
  label: string
  colorIndex: number
  value?: string
}

export interface RenderedChart {
  svg: string
  legend: ChartLegendEntry[]
}

export class ChartParseError extends Error {}

const TYPES: Record<string, ChartType> = {
  bar: 'bar',
  bars: 'bar',
  column: 'bar',
  line: 'line',
  lines: 'line',
  pie: 'pie',
  circle: 'pie',
  donut: 'pie',
  doughnut: 'pie'
}

// Eight categorical slots; more series than that fold into "Other" so the
// chart never invents a ninth hue.
export const CHART_SERIES_LIMIT = 8

function splitList(value: string): string[] {
  return value.split(/[,;|\t]/).map(s => s.trim()).filter(Boolean)
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.eE+-]/g, '')
  if (!cleaned) return Number.NaN
  return Number(cleaned)
}

export function parseChart(source: string): ChartSpec {
  const spec: ChartSpec = { type: 'bar', title: '', labels: [], series: [] }
  const lines = source.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const colon = line.indexOf(':')
    if (colon <= 0) throw new ChartParseError(`Every line needs a name and a colon, like "Sales: 1, 2, 3" — got "${line}".`)

    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    const lowered = key.toLowerCase()

    if (lowered === 'type') {
      const type = TYPES[value.toLowerCase()]
      if (!type) throw new ChartParseError(`Unknown chart type "${value}". Use bar, line or pie.`)
      spec.type = type
      continue
    }
    if (lowered === 'title') {
      spec.title = value
      continue
    }
    if (lowered === 'labels' || lowered === 'x' || lowered === 'categories') {
      spec.labels = splitList(value)
      continue
    }

    const values = splitList(value).map(parseNumber)
    const bad = splitList(value)[values.findIndex(Number.isNaN)]
    if (bad !== undefined) throw new ChartParseError(`"${bad}" in "${key}" is not a number.`)
    if (!values.length) throw new ChartParseError(`"${key}" has no values.`)
    spec.series.push({ name: key, values })
  }

  if (!spec.series.length) throw new ChartParseError('Add at least one series, like "Sales: 12, 19, 7".')

  if (spec.type === 'pie') {
    if (spec.series.length === 1 && spec.labels.length) {
      const only = spec.series[0]!
      spec.series = only.values.map((v, i) => ({ name: spec.labels[i] ?? `#${i + 1}`, values: [v] }))
      spec.labels = []
    } else if (spec.series.some(s => s.values.length !== 1)) {
      throw new ChartParseError('A pie takes one value per slice: "Name: value" per line, or one series with "labels".')
    }
    if (spec.series.some(s => s.values[0]! < 0)) throw new ChartParseError('A pie cannot show a negative value.')
  } else {
    const longest = Math.max(...spec.series.map(s => s.values.length))
    if (!spec.labels.length) spec.labels = Array.from({ length: longest }, (_, i) => String(i + 1))
    if (spec.labels.length < longest) {
      for (let i = spec.labels.length; i < longest; i++) spec.labels.push(String(i + 1))
    }
  }

  return spec
}

// ─── Drawing ─────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${trimZeros((n / 1e9).toFixed(1))}B`
  if (abs >= 1e6) return `${trimZeros((n / 1e6).toFixed(1))}M`
  if (abs >= 1e4) return `${trimZeros((n / 1e3).toFixed(1))}k`
  if (Number.isInteger(n)) return String(n)
  return trimZeros(n.toFixed(2))
}

function trimZeros(s: string): string {
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

/** Round axis bounds and step to something a reader expects to see. */
function niceScale(min: number, max: number, ticks = 5) {
  if (min === max) {
    max = min === 0 ? 1 : min + Math.abs(min)
    min = min === 0 ? 0 : min - Math.abs(min)
  }
  const span = max - min
  const rough = span / ticks
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const residual = rough / magnitude
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const values: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Number(v.toFixed(10)))
  return { lo, hi, values }
}

/** Series beyond the palette fold into a single "Other" line. */
function foldSeries(series: ChartSeries[]): ChartSeries[] {
  if (series.length <= CHART_SERIES_LIMIT) return series
  const kept = series.slice(0, CHART_SERIES_LIMIT - 1)
  const rest = series.slice(CHART_SERIES_LIMIT - 1)
  const length = Math.max(...rest.map(s => s.values.length))
  const other: ChartSeries = {
    name: 'Other',
    values: Array.from({ length }, (_, i) => rest.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  }
  return [...kept, other]
}

const W = 640
const H = 320
const PAD = { top: 16, right: 16, bottom: 44, left: 52 }
const FONT = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"'

function color(index: number): string {
  return `var(--chart-${index + 1})`
}

/** The attributes a hover tooltip reads off a mark. */
function markData(seriesIndex: number, label: string, value: string): string {
  return ` data-series="${seriesIndex}" data-label="${esc(label)}" data-value="${esc(value)}"`
}

function titleMarkup(title: string): string {
  if (!title) return ''
  return `<text x="${PAD.left}" y="14" ${FONT} font-size="13" font-weight="600" fill="var(--chart-ink)">${esc(title)}</text>`
}

function axes(spec: ChartSpec, top: number) {
  const all = spec.series.flatMap(s => s.values)
  const min = Math.min(0, ...all)
  const max = Math.max(0, ...all)
  const scale = niceScale(min, max)
  const plotTop = top
  const plotBottom = H - PAD.bottom
  const plotLeft = PAD.left
  const plotRight = W - PAD.right
  const y = (v: number) => plotBottom - ((v - scale.lo) / (scale.hi - scale.lo)) * (plotBottom - plotTop)

  let out = ''
  for (const v of scale.values) {
    const yy = y(v)
    const isBase = v === 0
    out += `<line x1="${plotLeft}" x2="${plotRight}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${isBase ? 'var(--chart-axis)' : 'var(--chart-grid)'}" stroke-width="1"/>`
    out += `<text x="${plotLeft - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" ${FONT} font-size="11" fill="var(--chart-muted)" style="font-variant-numeric: tabular-nums">${esc(formatNumber(v))}</text>`
  }

  const n = spec.labels.length
  const slot = (plotRight - plotLeft) / Math.max(n, 1)
  // Labels thin out rather than collide when there are many categories.
  const every = Math.max(1, Math.ceil(n / Math.floor((plotRight - plotLeft) / 56)))
  // The last label is shown only when it has room after the previous one.
  const lastShown = Math.floor((n - 1) / every) * every
  const showLast = n - 1 - lastShown >= every / 2
  spec.labels.forEach((label, i) => {
    if (i % every !== 0 && !(showLast && i === n - 1)) return
    if (showLast && i === lastShown && n - 1 - lastShown < every) return
    const x = plotLeft + slot * i + slot / 2
    const short = label.length > 14 ? `${label.slice(0, 13)}…` : label
    out += `<text x="${x.toFixed(1)}" y="${plotBottom + 18}" text-anchor="middle" ${FONT} font-size="11" fill="var(--chart-muted)">${esc(short)}</text>`
  })

  return { out, y, plotLeft, plotRight, plotTop, plotBottom, slot, baseline: y(0) }
}

function barChart(spec: ChartSpec): string {
  const top = spec.title ? PAD.top + 14 : PAD.top
  const ax = axes(spec, top)
  const seriesCount = spec.series.length
  const n = spec.labels.length
  const gap = 2
  const groupPad = Math.min(ax.slot * 0.2, 12)
  const barWidth = Math.max(2, (ax.slot - groupPad * 2 - gap * (seriesCount - 1)) / seriesCount)
  const radius = Math.min(4, barWidth / 2)

  let marks = ''
  spec.series.forEach((series, si) => {
    for (let i = 0; i < n; i++) {
      const v = series.values[i]
      if (v === undefined || !Number.isFinite(v)) continue
      const x = ax.plotLeft + ax.slot * i + groupPad + si * (barWidth + gap)
      const yv = ax.y(v)
      const y0 = ax.baseline
      const h = Math.abs(y0 - yv)
      const yTop = Math.min(y0, yv)
      const r = Math.min(radius, h)
      const up = v >= 0
      // Rounded on the data end only; the baseline end stays square.
      const path = up
        ? `M${x},${y0} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barWidth - r} Q${x + barWidth},${yTop} ${x + barWidth},${yTop + r} V${y0} Z`
        : `M${x},${y0} V${yTop + h - r} Q${x},${yTop + h} ${x + r},${yTop + h} H${x + barWidth - r} Q${x + barWidth},${yTop + h} ${x + barWidth},${yTop + h - r} V${y0} Z`
      marks += `<path d="${path}" fill="${color(si)}" class="chart-mark"${markData(si, `${series.name} · ${spec.labels[i] ?? ''}`, formatNumber(v))}/>`
    }
  })

  return `${titleMarkup(spec.title)}${ax.out}${marks}`
}

function lineChart(spec: ChartSpec): string {
  const top = spec.title ? PAD.top + 14 : PAD.top
  const ax = axes(spec, top)
  const n = spec.labels.length

  let marks = ''
  spec.series.forEach((series, si) => {
    const points: [number, number][] = []
    for (let i = 0; i < n; i++) {
      const v = series.values[i]
      if (v === undefined || !Number.isFinite(v)) continue
      points.push([ax.plotLeft + ax.slot * i + ax.slot / 2, ax.y(v)])
    }
    if (!points.length) return
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    marks += `<path d="${d}" fill="none" stroke="${color(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    points.forEach(([x, y], i) => {
      const data = markData(si, `${series.name} · ${spec.labels[i] ?? ''}`, formatNumber(series.values[i]!))
      // A wide invisible ring makes the marker easy to hit; the visible dot stays small.
      marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color(si)}" stroke="var(--chart-surface)" stroke-width="2" class="chart-mark"/>`
      marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="transparent" class="chart-mark chart-mark--hit"${data}/>`
    })
  })

  return `${titleMarkup(spec.title)}${ax.out}${marks}`
}

function pieChart(spec: ChartSpec): { body: string, legend: ChartLegendEntry[] } {
  const total = spec.series.reduce((sum, s) => sum + s.values[0]!, 0)
  const cx = W / 2
  const top = spec.title ? PAD.top + 14 : PAD.top
  const radius = Math.min((H - top - PAD.top) / 2, 130)
  const cy = top + (H - top - PAD.top) / 2
  const inner = radius * 0.55

  let marks = ''
  let angle = -Math.PI / 2
  const legend: ChartLegendEntry[] = []

  spec.series.forEach((series, si) => {
    const v = series.values[0]!
    const share = total > 0 ? v / total : 0
    legend.push({ label: series.name, colorIndex: si, value: `${formatNumber(v)} · ${(share * 100).toFixed(share < 0.1 && share > 0 ? 1 : 0)}%` })
    if (share <= 0) return

    const start = angle
    const end = angle + share * Math.PI * 2
    angle = end
    const large = share > 0.5 ? 1 : 0
    const data = markData(si, series.name, `${formatNumber(v)} · ${(share * 100).toFixed(1)}%`)

    let d: string
    if (share >= 0.9999) {
      // A single full slice: a ring, since an arc cannot close on itself.
      d = `M${cx},${cy - radius} A${radius},${radius} 0 1 1 ${cx},${cy + radius} A${radius},${radius} 0 1 1 ${cx},${cy - radius} Z`
        + ` M${cx},${cy - inner} A${inner},${inner} 0 1 0 ${cx},${cy + inner} A${inner},${inner} 0 1 0 ${cx},${cy - inner} Z`
      marks += `<path d="${d}" fill="${color(si)}" fill-rule="evenodd" class="chart-mark"${data}/>`
    } else {
      const x1 = cx + radius * Math.cos(start)
      const y1 = cy + radius * Math.sin(start)
      const x2 = cx + radius * Math.cos(end)
      const y2 = cy + radius * Math.sin(end)
      const ix1 = cx + inner * Math.cos(end)
      const iy1 = cy + inner * Math.sin(end)
      const ix2 = cx + inner * Math.cos(start)
      const iy2 = cy + inner * Math.sin(start)
      d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${radius},${radius} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`
        + ` L${ix1.toFixed(2)},${iy1.toFixed(2)} A${inner},${inner} 0 ${large} 0 ${ix2.toFixed(2)},${iy2.toFixed(2)} Z`
      marks += `<path d="${d}" fill="${color(si)}" stroke="var(--chart-surface)" stroke-width="2" stroke-linejoin="round" class="chart-mark"${data}/>`
    }

    if (share >= 0.06) {
      const mid = (start + end) / 2
      const lr = (radius + inner) / 2
      const lx = cx + lr * Math.cos(mid)
      const ly = cy + lr * Math.sin(mid)
      marks += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" ${FONT} font-size="11" font-weight="600" fill="var(--chart-on-${(si % CHART_SERIES_LIMIT) + 1})" pointer-events="none">${Math.round(share * 100)}%</text>`
    }
  })

  if (total > 0) {
    marks += `<text x="${cx}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" ${FONT} font-size="15" font-weight="600" fill="var(--chart-ink)">${esc(formatNumber(total))}</text>`
  }

  return { body: `${titleMarkup(spec.title)}${marks}`, legend }
}

export function renderChart(spec: ChartSpec): RenderedChart {
  const folded: ChartSpec = { ...spec, series: foldSeries(spec.series) }
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(spec.title || `${spec.type} chart`)}" class="chart-svg">`
  const close = '</svg>'

  if (folded.type === 'pie') {
    const { body, legend } = pieChart(folded)
    return { svg: `${open}${body}${close}`, legend }
  }

  const body = folded.type === 'line' ? lineChart(folded) : barChart(folded)
  // A single series is named by the title, so it needs no legend.
  const legend = folded.series.length > 1
    ? folded.series.map((s, i) => ({ label: s.name, colorIndex: i }))
    : []
  return { svg: `${open}${body}${close}`, legend }
}

export const CHART_TEMPLATE = `type: bar
title: Monthly revenue
labels: Jan, Feb, Mar, Apr
Revenue: 12, 19, 14, 22
Costs: 8, 9, 10, 11`

export const MERMAID_TEMPLATE = `flowchart LR
  A[Idea] --> B{Worth it?}
  B -- Yes --> C[Build]
  B -- No --> D[Park it]`
