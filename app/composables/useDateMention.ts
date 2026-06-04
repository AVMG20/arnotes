import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { VueRenderer } from '@tiptap/vue-3'
import {
  startOfDay,
  addDays,
  nextMonday,
  nextTuesday,
  nextWednesday,
  nextThursday,
  nextFriday,
  nextSaturday,
  nextSunday,
  format,
  isToday,
  isTomorrow,
  isYesterday,
  differenceInCalendarDays,
  differenceInMinutes,
  differenceInHours
} from 'date-fns'
import DateSuggestionList from '~/components/DateSuggestionList.vue'

// ─── Date display ─────────────────────────────────────────────

export function formatDateMention(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0

  if (hasTime) {
    const mins = differenceInMinutes(date, now)
    if (Math.abs(mins) < 1) return 'just now'
    if (mins > 0 && mins < 60) return `in ${mins}m`
    if (mins < 0 && mins > -60) return `${Math.abs(mins)}m ago`
    const hrs = differenceInHours(date, now)
    return hrs > 0 ? `in ${Math.abs(hrs)}h` : `${Math.abs(hrs)}h ago`
  }

  if (isToday(date)) return 'today'
  if (isTomorrow(date)) return 'tomorrow'
  if (isYesterday(date)) return 'yesterday'

  const diff = differenceInCalendarDays(date, now)
  if (diff > 1 && diff < 7) return `in ${diff} days`
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`

  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

// ─── Suggestion items ─────────────────────────────────────────

export interface DateItem {
  id: string
  label: string
  hint: string
  date: string
}

function fmtHint(d: Date) {
  return format(d, 'EEE, MMM d')
}

function buildItems(): DateItem[] {
  const now = new Date()
  const tod = startOfDay(now)
  return [
    { id: 'now', label: 'Now', hint: format(now, 'h:mm a'), date: now.toISOString() },
    { id: 'today', label: 'Today', hint: fmtHint(tod), date: tod.toISOString() },
    { id: 'tomorrow', label: 'Tomorrow', hint: fmtHint(addDays(tod, 1)), date: addDays(tod, 1).toISOString() },
    { id: 'yesterday', label: 'Yesterday', hint: fmtHint(addDays(tod, -1)), date: addDays(tod, -1).toISOString() },
    { id: 'next-week', label: 'Next week', hint: fmtHint(addDays(tod, 7)), date: addDays(tod, 7).toISOString() },
    { id: 'last-week', label: 'Last week', hint: fmtHint(addDays(tod, -7)), date: addDays(tod, -7).toISOString() },
    { id: 'monday', label: 'Next Monday', hint: fmtHint(nextMonday(tod)), date: nextMonday(tod).toISOString() },
    { id: 'tuesday', label: 'Next Tuesday', hint: fmtHint(nextTuesday(tod)), date: nextTuesday(tod).toISOString() },
    { id: 'wednesday', label: 'Next Wednesday', hint: fmtHint(nextWednesday(tod)), date: nextWednesday(tod).toISOString() },
    { id: 'thursday', label: 'Next Thursday', hint: fmtHint(nextThursday(tod)), date: nextThursday(tod).toISOString() },
    { id: 'friday', label: 'Next Friday', hint: fmtHint(nextFriday(tod)), date: nextFriday(tod).toISOString() },
    { id: 'saturday', label: 'Next Saturday', hint: fmtHint(nextSaturday(tod)), date: nextSaturday(tod).toISOString() },
    { id: 'sunday', label: 'Next Sunday', hint: fmtHint(nextSunday(tod)), date: nextSunday(tod).toISOString() }
  ]
}

export function filterDateItems(query: string): DateItem[] {
  const all = buildItems()
  if (!query) return all.slice(0, 6)
  const q = query.toLowerCase()
  return all.filter(i => i.label.toLowerCase().includes(q) || i.id.includes(q)).slice(0, 6)
}

// ─── DateMention Tiptap node ──────────────────────────────────

const dateMentionKey = new PluginKey('dateMention')

export const DateMention = Node.create({
  name: 'dateMention',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return { date: { default: null } }
  },

  parseHTML() {
    return [{ tag: 'span[data-date-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-date-mention': node.attrs.date,
      class: 'date-mention'
    }), formatDateMention(node.attrs.date)]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.setAttribute('data-date-mention', node.attrs.date)
      dom.className = 'date-mention'

      const update = () => {
        dom.textContent = formatDateMention(node.attrs.date)
        // Full date shown in tooltip via CSS attr()
        const d = new Date(node.attrs.date)
        const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0
        dom.setAttribute(
          'data-full-date',
          hasTime
            ? format(d, "EEEE, MMMM d, yyyy 'at' h:mm a")
            : format(d, 'EEEE, MMMM d, yyyy')
        )
      }
      update()
      const timer = setInterval(update, 30000)
      return { dom, destroy() { clearInterval(timer) } }
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: dateMentionKey,
        editor: this.editor,
        char: '@',
        allowSpaces: false,
        items: ({ query }) => filterDateItems(query),

        render: () => {
          let renderer: VueRenderer | null = null

          const reposition = (clientRect: (() => DOMRect | null) | null) => {
            if (!clientRect || !renderer?.element) return
            const rect = clientRect()
            if (!rect) return
            const el = renderer.element as HTMLElement
            el.style.top = `${rect.bottom + 6}px`
            el.style.left = `${rect.left}px`
          }

          return {
            onStart(props) {
              renderer = new VueRenderer(DateSuggestionList, { props, editor: props.editor })
              const el = renderer.element as HTMLElement
              el.style.position = 'fixed'
              el.style.zIndex = '9999'
              document.body.appendChild(el)
              reposition(props.clientRect ?? null)
            },
            onUpdate(props) {
              renderer?.updateProps(props)
              reposition(props.clientRect ?? null)
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') { renderer?.destroy(); renderer = null; return true }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (renderer?.ref as any)?.onKeyDown(event) ?? false
            },
            onExit() { renderer?.destroy(); renderer = null }
          }
        },

        command: ({ editor, range, props }) => {
          const item = props as DateItem
          editor.chain().focus()
            .deleteRange(range)
            .insertContent({ type: 'dateMention', attrs: { date: item.date } })
            .insertContent(' ')
            .run()
        }
      })
    ]
  }
})
