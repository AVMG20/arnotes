// The one palette in the app, shared by the client and the API so a colour
// picked on a column, a label or the accent in Settings is chosen from the same
// list — and so the server can tell a real colour name from anything else.
//
// Tailwind v4 does not emit CSS variables for class names it never sees, and it
// cannot compile a class string built at runtime, so a stored colour is applied
// as an inline style from the hex table below rather than as a utility class.
// The colours derived from a name (see app/utils/tagColors.ts) stay on semantic
// classes, because those are meant to follow the user's theme.

export const ACCENT_COLORS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'
] as const

export const NEUTRAL_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const

export type AccentColor = typeof ACCENT_COLORS[number]
export type NeutralColor = typeof NEUTRAL_COLORS[number]

export const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', slate: '#64748b', gray: '#6b7280', zinc: '#71717a',
  neutral: '#737373', stone: '#78716c'
}

/** Guards anything arriving from a request body or an agent's tool call. */
export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value)
}

export function colorHex(color: string): string {
  return COLOR_HEX[color] ?? '#888888'
}

/**
 * A colour chosen by the user, as a chip: the colour itself for the text and
 * the ring, a wash of it behind. Written with `color-mix` so one hex covers
 * both themes instead of needing a light and a dark value per colour.
 */
export function chipStyle(color: string) {
  const hex = colorHex(color)
  return {
    'color': hex,
    'backgroundColor': `color-mix(in srgb, ${hex} 12%, transparent)`,
    '--tw-ring-color': `color-mix(in srgb, ${hex} 30%, transparent)`
  }
}
