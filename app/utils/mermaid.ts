// Mermaid is a large library and most notes never draw a diagram, so it is
// loaded on first use. Rendering runs in strict mode: the diagram text can
// come from an agent over MCP, and strict mode keeps HTML labels and click
// handlers out of the SVG it produces.
//
// The diagrams are drawn in the app's own palette rather than Mermaid's
// purple: zinc surfaces and ink, emerald for the primary fill, in both modes.

import type { MermaidConfig } from 'mermaid'

type MermaidModule = typeof import('mermaid').default

let loading: Promise<MermaidModule> | null = null
let configuredDark: boolean | null = null
let counter = 0

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

const LIGHT = {
  background: '#ffffff',
  primaryColor: '#ecfdf5',
  primaryTextColor: '#18181b',
  primaryBorderColor: '#34d399',
  secondaryColor: '#f4f4f5',
  secondaryTextColor: '#18181b',
  secondaryBorderColor: '#d4d4d8',
  tertiaryColor: '#fafafa',
  tertiaryTextColor: '#3f3f46',
  tertiaryBorderColor: '#e4e4e7',
  lineColor: '#71717a',
  textColor: '#3f3f46',
  mainBkg: '#ecfdf5',
  nodeBorder: '#34d399',
  clusterBkg: '#fafafa',
  clusterBorder: '#d4d4d8',
  edgeLabelBackground: '#f4f4f5',
  titleColor: '#18181b',
  noteBkgColor: '#fef9c3',
  noteTextColor: '#713f12',
  noteBorderColor: '#fde047',
  actorBkg: '#ecfdf5',
  actorBorder: '#34d399',
  actorTextColor: '#18181b',
  actorLineColor: '#a1a1aa',
  signalColor: '#3f3f46',
  signalTextColor: '#3f3f46',
  labelBoxBkgColor: '#f4f4f5',
  labelBoxBorderColor: '#d4d4d8',
  labelTextColor: '#18181b',
  loopTextColor: '#18181b',
  activationBkgColor: '#d1fae5',
  activationBorderColor: '#34d399',
  sectionBkgColor: '#f4f4f5',
  altSectionBkgColor: '#ffffff',
  sectionBkgColor2: '#ecfdf5',
  taskBkgColor: '#34d399',
  taskBorderColor: '#059669',
  taskTextColor: '#052e16',
  taskTextLightColor: '#052e16',
  taskTextDarkColor: '#052e16',
  activeTaskBkgColor: '#a7f3d0',
  activeTaskBorderColor: '#059669',
  doneTaskBkgColor: '#e4e4e7',
  doneTaskBorderColor: '#a1a1aa',
  gridColor: '#e4e4e7',
  todayLineColor: '#e34948',
  // Pie slices take the chart palette, so a Mermaid pie matches a chart block.
  pie1: '#2a78d6',
  pie2: '#eb6834',
  pie3: '#1baf7a',
  pie4: '#eda100',
  pie5: '#e87ba4',
  pie6: '#008300',
  pie7: '#4a3aa7',
  pie8: '#e34948',
  pieStrokeColor: '#ffffff',
  pieOuterStrokeColor: '#ffffff',
  pieStrokeWidth: '2px',
  pieOuterStrokeWidth: '0px',
  pieOpacity: '1',
  pieSectionTextColor: '#0b0b0b',
  pieSectionTextSize: '15px',
  pieTitleTextColor: '#18181b',
  pieLegendTextColor: '#3f3f46',
  fontFamily: FONT,
  fontSize: '14px'
}

const DARK = {
  darkMode: true,
  background: '#171717',
  primaryColor: '#064e3b',
  primaryTextColor: '#e4e4e7',
  primaryBorderColor: '#10b981',
  secondaryColor: '#27272a',
  secondaryTextColor: '#e4e4e7',
  secondaryBorderColor: '#3f3f46',
  tertiaryColor: '#1f1f22',
  tertiaryTextColor: '#d4d4d8',
  tertiaryBorderColor: '#3f3f46',
  lineColor: '#a1a1aa',
  textColor: '#e4e4e7',
  mainBkg: '#064e3b',
  nodeBorder: '#10b981',
  clusterBkg: '#1f1f22',
  clusterBorder: '#3f3f46',
  edgeLabelBackground: '#27272a',
  titleColor: '#fafafa',
  noteBkgColor: '#713f12',
  noteTextColor: '#fef9c3',
  noteBorderColor: '#a16207',
  actorBkg: '#064e3b',
  actorBorder: '#10b981',
  actorTextColor: '#e4e4e7',
  actorLineColor: '#52525b',
  signalColor: '#d4d4d8',
  signalTextColor: '#d4d4d8',
  labelBoxBkgColor: '#27272a',
  labelBoxBorderColor: '#3f3f46',
  labelTextColor: '#e4e4e7',
  loopTextColor: '#e4e4e7',
  activationBkgColor: '#065f46',
  activationBorderColor: '#10b981',
  sectionBkgColor: '#27272a',
  altSectionBkgColor: '#171717',
  sectionBkgColor2: '#1f1f22',
  taskBkgColor: '#059669',
  taskBorderColor: '#34d399',
  taskTextColor: '#f0fdf4',
  taskTextLightColor: '#f0fdf4',
  taskTextDarkColor: '#f0fdf4',
  activeTaskBkgColor: '#10b981',
  activeTaskBorderColor: '#6ee7b7',
  doneTaskBkgColor: '#3f3f46',
  doneTaskBorderColor: '#71717a',
  gridColor: '#3f3f46',
  todayLineColor: '#e66767',
  pie1: '#3987e5',
  pie2: '#d95926',
  pie3: '#199e70',
  pie4: '#c98500',
  pie5: '#d55181',
  pie6: '#008300',
  pie7: '#9085e9',
  pie8: '#e66767',
  pieStrokeColor: '#171717',
  pieOuterStrokeColor: '#171717',
  pieStrokeWidth: '2px',
  pieOuterStrokeWidth: '0px',
  pieOpacity: '1',
  pieSectionTextColor: '#0b0b0b',
  pieSectionTextSize: '15px',
  pieTitleTextColor: '#fafafa',
  pieLegendTextColor: '#e4e4e7',
  fontFamily: FONT,
  fontSize: '14px'
}

/** The Mermaid configuration for one colour mode. */
export function mermaidConfig(dark: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: 'base' as const,
    themeVariables: dark ? DARK : LIGHT,
    fontFamily: FONT,
    flowchart: { curve: 'basis', padding: 12, htmlLabels: false },
    sequence: { actorMargin: 40 },
    // Dates as "06 Sep" fit the column width; a diagram's own axisFormat still wins.
    gantt: { axisFormat: '%d %b', fontSize: 12 }
  }
}

async function load(): Promise<MermaidModule> {
  loading ??= import('mermaid').then(m => m.default)
  return loading
}

export async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const mermaid = await load()
  if (configuredDark !== dark) {
    mermaid.initialize(mermaidConfig(dark))
    configuredDark = dark
  }
  const id = `mermaid-${counter++}-${Date.now().toString(36)}`
  try {
    const { svg } = await mermaid.render(id, code)
    return svg
  } finally {
    // A failed parse can leave its scratch element behind in the body.
    document.getElementById(`d${id}`)?.remove()
  }
}

/** Mermaid's parse errors run to many lines of grammar; keep the useful ones. */
export function describeMermaidError(error: unknown): string {
  const message = (error as Error)?.message ?? ''
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean)
  const where = lines.find(l => /^Parse error on line/i.test(l))
  const expecting = lines.find(l => /^Expecting/i.test(l))
  if (where && expecting) {
    // The list of every token the grammar would accept is noise; the token it
    // actually found is the useful half.
    const got = /got\s+(.+)$/i.exec(expecting)?.[1]
    return got ? `${where.replace(/:$/, '')} — unexpected ${got}.` : `${where} ${expecting.slice(0, 120)}`
  }
  return lines.slice(0, 2).join(' ').slice(0, 200) || 'Could not draw this diagram.'
}
