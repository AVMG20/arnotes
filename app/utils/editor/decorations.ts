import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// ─── Hashtags ────────────────────────────────────────────────

// `#tags` in the text are what a note is filed under; they are tinted where
// they stand rather than being a node of their own.
export const HashtagHighlight = Extension.create({
  name: 'hashtagHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtagHighlight'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const pattern = /#[a-zA-Z][a-zA-Z0-9_]*/g
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              for (const match of node.text.matchAll(pattern)) {
                const from = pos + match.index
                decorations.push(Decoration.inline(from, from + match[0].length, { class: 'hashtag-highlight' }))
              }
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})

// ─── Selection kept visible while focus is elsewhere ─────────

// Typing a link's URL moves focus into an input, and the browser stops drawing
// the editor's selection. This paints it back so it stays clear what the link
// is going on.
export const BlurredSelection = Extension.create({
  name: 'blurredSelection',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('blurredSelection'),
        props: {
          decorations(state) {
            const { from, to, empty } = state.selection
            if (empty || editor.isFocused || !editor.isEditable) return null
            return DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: 'editor-blurred-selection' })])
          }
        }
      })
    ]
  }
})

// ─── AI feedback ─────────────────────────────────────────────

// What the AI is working on: a selection being rewritten shimmers, and text
// being generated gets a "writing" marker at the point it will appear.
export interface AiPending {
  kind: 'generate' | 'transform'
  from: number
  to: number
}

const aiPendingKey = new PluginKey<AiPending | null>('aiPending')

function writingIndicator(): HTMLElement {
  const indicator = document.createElement('span')
  indicator.className = 'ai-writing-indicator'
  indicator.contentEditable = 'false'
  indicator.setAttribute('aria-label', 'AI is writing')

  const label = document.createElement('span')
  label.textContent = 'AI is writing'
  indicator.append(label)
  for (let index = 0; index < 3; index++) {
    const dot = document.createElement('i')
    dot.style.setProperty('--ai-dot-index', String(index))
    indicator.append(dot)
  }
  return indicator
}

export const AiPendingDecoration = Extension.create({
  name: 'aiPendingDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin<AiPending | null>({
        key: aiPendingKey,
        state: {
          init: () => null,
          apply(transaction, pending) {
            const meta = transaction.getMeta(aiPendingKey) as { pending?: AiPending, clear?: boolean } | undefined
            if (meta?.clear) return null
            if (meta?.pending) return meta.pending
            if (!pending || !transaction.docChanged) return pending

            return {
              ...pending,
              from: transaction.mapping.map(pending.from, 1),
              to: transaction.mapping.map(pending.to, pending.kind === 'transform' ? -1 : 1)
            }
          }
        },
        props: {
          decorations(state) {
            const pending = aiPendingKey.getState(state)
            if (!pending) return null

            if (pending.kind === 'transform' && pending.from < pending.to) {
              return DecorationSet.create(state.doc, [
                Decoration.inline(pending.from, pending.to, { class: 'ai-processing-selection' })
              ])
            }

            return DecorationSet.create(state.doc, [
              Decoration.widget(pending.from, writingIndicator, { key: 'ai-writing-indicator', side: 1 })
            ])
          }
        }
      })
    ]
  }
})

export function setAiPending(editor: Editor, pending: AiPending | null) {
  editor.view.dispatch(editor.state.tr.setMeta(aiPendingKey, pending ? { pending } : { clear: true }))
}
