// Deterministic per-tag color so the same label looks identical everywhere
// (card, drawer, board filter) without storing a color anywhere. Colors are
// Nuxt UI semantic badge colors; chip classes are prebuilt because Tailwind
// cannot compile dynamic class strings.
const TAG_COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const

export type TagColor = typeof TAG_COLORS[number]

export function tagColor(tag: string): TagColor {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!
}

// Static full class strings — safe for Tailwind's scanner.
const TAG_CHIP_CLASSES: Record<TagColor, string> = {
  primary: 'bg-primary/10 text-primary dark:text-primary-400 ring-primary/25',
  secondary: 'bg-secondary/10 text-secondary dark:text-secondary-400 ring-secondary/25',
  success: 'bg-success/10 text-success dark:text-success-400 ring-success/25',
  info: 'bg-info/10 text-info dark:text-info-400 ring-info/25',
  warning: 'bg-warning/10 text-warning dark:text-warning-400 ring-warning/25',
  error: 'bg-error/10 text-error dark:text-error-400 ring-error/25'
}

export function tagChipClass(tag: string): string {
  return TAG_CHIP_CLASSES[tagColor(tag)]
}

// ─── Column accents ───────────────────────────────────────────────────────────

// A kanban column reads faster with a colored dot than with text alone. The
// well-known stage names get the colour people expect (Done is green, Backlog
// is grey); anything custom falls back to a stable hash so a renamed column
// keeps one identity.
const COLUMN_DOT_CLASSES = {
  neutral: 'bg-neutral-400 dark:bg-neutral-500',
  info: 'bg-info',
  primary: 'bg-primary',
  warning: 'bg-warning',
  success: 'bg-success',
  error: 'bg-error'
} as const

type ColumnAccent = keyof typeof COLUMN_DOT_CLASSES

const COLUMN_KEYWORDS: [RegExp, ColumnAccent][] = [
  [/backlog|idea|later|someday/i, 'neutral'],
  [/to.?do|todo|planned|ready|next/i, 'info'],
  [/progress|doing|active|building|dev/i, 'primary'],
  [/verify|review|test|qa|blocked|waiting/i, 'warning'],
  [/done|shipped|complete|closed|live/i, 'success'],
  [/cancel|reject|dropped|archive/i, 'error']
]

const ACCENT_CYCLE: ColumnAccent[] = ['info', 'primary', 'warning', 'success', 'error', 'neutral']

export function columnAccent(name: string): ColumnAccent {
  for (const [pattern, accent] of COLUMN_KEYWORDS) {
    if (pattern.test(name)) return accent
  }
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return ACCENT_CYCLE[Math.abs(hash) % ACCENT_CYCLE.length]!
}

export function columnDotClass(name: string): string {
  return COLUMN_DOT_CLASSES[columnAccent(name)]
}
