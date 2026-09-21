import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion, { type SuggestionMatch, type Trigger } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { VueRenderer } from '@tiptap/vue-3'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import {
  format,
  isToday,
  isTomorrow,
  isYesterday,
  differenceInCalendarDays,
  differenceInMinutes
} from 'date-fns'
import DateSuggestionList from '~/components/DateSuggestionList.vue'
import { suggestDates, type DateItem } from '~/utils/editor/date-parser'

// ─── Date display ─────────────────────────────────────────────

function hasTime(date: Date): boolean {
  return date.getHours() !== 0 || date.getMinutes() !== 0
}

function formatDay(date: Date, now: Date): string {
  if (isToday(date)) return 'today'
  if (isTomorrow(date)) return 'tomorrow'
  if (isYesterday(date)) return 'yesterday'

  const diff = differenceInCalendarDays(date, now)
  if (diff > 1 && diff < 7) return format(date, 'EEEE')
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`

  return format(date, date.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')
}

// The chip reads the way the date would be said today: "tomorrow", "Friday",
// "Oct 3", and with a time "tomorrow 15:00" — or "in 20m" when it is close.
export function formatDateMention(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'date'
  const now = new Date()
  if (!hasTime(date)) return formatDay(date, now)

  const minutes = differenceInMinutes(date, now)
  if (Math.abs(minutes) < 1) return 'now'
  if (minutes > 0 && minutes < 60) return `in ${minutes}m`
  if (minutes < 0 && minutes > -60) return `${Math.abs(minutes)}m ago`
  return `${formatDay(date, now)} ${format(date, 'HH:mm')}`
}

function fullDate(date: Date): string {
  return format(date, hasTime(date) ? 'EEEE, MMMM d, yyyy · HH:mm' : 'EEEE, MMMM d, yyyy')
}

// Whether the date is behind us, so a missed one can look missed.
function isPast(date: Date): boolean {
  return hasTime(date) ? date.getTime() < Date.now() : differenceInCalendarDays(date, new Date()) < 0
}

// ─── Matching what is typed after `@` ─────────────────────────

// Dates take spaces ("next friday", "in 3 days"), which a suggestion normally
// ends at. So the text after `@` is matched by hand: up to four words, and once
// there is a space only for as long as it still reads as a date — typing on
// past "@tomorrow we ship" lets go of the menu instead of trailing it along.
function findDateMatch({ $position }: Trigger): SuggestionMatch {
  const before = $position.nodeBefore
  if (!before?.isText || !before.text) return null

  const match = /(?:^|\s)@([\w:./-]*(?: [\w:./-]*){0,3})$/.exec(before.text)
  if (!match) return null
  const query = match[1]!
  if (query.includes(' ') && !suggestDates(query).length) return null

  const to = $position.pos
  const from = to - query.length - 1
  return { range: { from, to }, query, text: `@${query}` }
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
      'class': 'date-mention'
    }), formatDateMention(node.attrs.date)]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.setAttribute('data-date-mention', node.attrs.date)
      dom.className = 'date-mention'

      const update = () => {
        const date = new Date(node.attrs.date)
        dom.textContent = formatDateMention(node.attrs.date)
        dom.title = fullDate(date)
        dom.classList.toggle('date-mention-past', isPast(date))
      }
      update()
      // Relative labels ("in 20m", "today") go stale while the note is open.
      const timer = setInterval(update, 30000)
      return {
        dom,
        destroy() {
          clearInterval(timer)
        }
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<DateItem>({
        pluginKey: dateMentionKey,
        editor: this.editor,
        char: '@',
        findSuggestionMatch: findDateMatch,
        items: ({ query }) => suggestDates(query),

        render: () => {
          let renderer: VueRenderer | null = null
          let host: HTMLElement | null = null

          const reposition = (clientRect?: (() => DOMRect | null) | null) => {
            if (!clientRect || !host) return
            const reference = { getBoundingClientRect: () => clientRect() ?? new DOMRect() }
            computePosition(reference, host, {
              placement: 'bottom-start',
              strategy: 'absolute',
              middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })]
            }).then(({ x, y }) => {
              if (host) Object.assign(host.style, { left: `${x}px`, top: `${y}px` })
            })
          }

          const close = () => {
            renderer?.destroy()
            host?.remove()
            renderer = null
            host = null
          }

          return {
            onStart(props) {
              renderer = new VueRenderer(DateSuggestionList, { props, editor: props.editor })
              // The list is mounted inside the editor rather than on the body:
              // around a modal panel (the task drawer) only what is inside the
              // panel takes pointer events.
              host = document.createElement('div')
              host.style.position = 'absolute'
              host.style.zIndex = '50'
              // Keeps the caret in the editor while an item is clicked.
              host.addEventListener('mousedown', event => event.preventDefault())
              if (renderer.element) host.appendChild(renderer.element)
              props.editor.view.dom.parentElement?.appendChild(host)
              reposition(props.clientRect)
            },
            onUpdate(props) {
              renderer?.updateProps(props)
              reposition(props.clientRect)
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') {
                close()
                return true
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (renderer?.ref as any)?.onKeyDown(event) ?? false
            },
            onExit: close
          }
        },

        command: ({ editor, range, props: item }) => {
          editor.chain().focus()
            .deleteRange(range)
            .insertContent([{ type: 'dateMention', attrs: { date: item.date } }, { type: 'text', text: ' ' }])
            .run()
        }
      })
    ]
  }
})
