import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMParser as ProseMirrorDOMParser, DOMSerializer, Slice, type Fragment } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { convertTaskLists, htmlToMarkdown, markdownToHtml } from '~/utils/markdown'

// Everything that crosses the clipboard. Going in, the editor takes whatever it
// is handed and makes the best document of it: formatted HTML stays formatted,
// Markdown source becomes what it describes, a URL over a selection becomes a
// link, source code becomes a code block, an image is uploaded. Going out, the
// plain-text side of a copy is Markdown, so a note pastes cleanly into a
// terminal, a commit message or another Markdown tool.

export type ImageUploader = (file: File) => Promise<string | null>

export interface SmartClipboardOptions {
  // A getter, because the uploader is a component prop and may change.
  getUploader: () => ImageUploader | undefined
}

// ─── Reading the clipboard ───────────────────────────────────

const URL_ONLY = /^https?:\/\/[^\s<>]+$/i

const MARKDOWN_SIGNALS: RegExp[] = [
  /^#{1,6}\s+\S/m, // heading
  /^\s*[-*+]\s+\S/m, // bullet (and task) list
  /^\s*\d+[.)]\s+\S/m, // numbered list
  /^>\s?\S/m, // blockquote
  /^(```|~~~)/m, // fence
  /^\s*([-*_])(\s*\1){2,}\s*$/m, // rule
  /^\|.+\|\s*\n\|?\s*:?-{2,}/m, // table
  /\*\*[^*\n]+\*\*/, // bold
  /__[^_\n]+__/,
  /~~[^~\n]+~~/, // strike
  /==[^=\n]+==/, // highlight
  /`[^`\n]+`/, // code
  /!?\[[^\]\n]+\]\([^)\s]+\)/ // link or image
]

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SIGNALS.some(signal => signal.test(text))
}

const SEMANTIC_TAGS = 'h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre,code,strong,b,em,i,u,s,del,mark,a[href],img,hr'

// Whether pasted HTML says anything the plain text does not. Browsers and
// editors wrap a plain copy in styled spans; that wrapper carries no structure,
// and the text under it may well be Markdown source.
function isFormattedHtml(html: string): boolean {
  if (!html) return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return !!doc.body.querySelector(SEMANTIC_TAGS)
}

// Some sources (browsers copying a rendered page) put only HTML on the
// clipboard; the text inside it is what a code block wants.
function plainTextFromHtml(html: string): string {
  if (!html) return ''
  // A parsed-but-unrendered document has no layout, so `innerText` would not
  // turn line breaks into newlines; they are marked in the markup first.
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|pre|blockquote)>/gi, '\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return (doc.body.textContent ?? '').replace(/\n$/, '')
}

// VS Code names the language of what was copied. Prose modes are left alone.
const PROSE_MODES = new Set(['markdown', 'plaintext', 'mdx', 'text'])
const MODE_ALIASES: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  shellscript: 'bash',
  dockerfile: 'docker',
  jsonc: 'json'
}

function sourceLanguage(data: DataTransfer): string | null {
  const raw = data.getData('vscode-editor-data')
  if (!raw) return null
  try {
    const mode = String((JSON.parse(raw) as { mode?: string }).mode ?? '')
    if (!mode || PROSE_MODES.has(mode)) return null
    return MODE_ALIASES[mode] ?? mode
  } catch {
    return null
  }
}

// Pasted HTML tidied before ProseMirror parses it: the wrappers and leftovers
// office suites add, and checkbox lists in the shape other tools write them.
export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('meta, style, script, link, title, o\\:p').forEach(node => node.remove())

  const comments = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT)
  const stale: Node[] = []
  while (comments.nextNode()) stale.push(comments.currentNode)
  stale.forEach(node => node.parentNode?.removeChild(node))

  // Google Docs wraps the whole copy in a `<b>` that means nothing.
  doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach(node => node.replaceWith(...node.childNodes))

  convertTaskLists(doc.body)
  return doc.body.innerHTML
}

// ─── Writing into the document ───────────────────────────────

// HTML goes in as a slice, the way a native paste does. A single pasted line is
// left open at both ends so it joins the paragraph the caret is in; anything
// with structure (a heading, a list, several blocks) goes in closed, so it
// lands as blocks of its own instead of bleeding into that paragraph.
function pasteHtml(view: EditorView, html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  const { state } = view
  const parsed = ProseMirrorDOMParser.fromSchema(state.schema).parseSlice(container, {
    preserveWhitespace: false,
    context: state.selection.$from
  })
  const inline = parsed.content.childCount === 1 && parsed.content.firstChild?.type.name === 'paragraph'
  const slice = inline ? parsed : new Slice(parsed.content, 0, 0)
  view.dispatch(state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
}

function pasteCodeBlock(editor: Editor, text: string, language: string) {
  editor.chain().focus().insertContent({
    type: 'codeBlock',
    attrs: { language },
    content: [{ type: 'text', text }]
  }).run()
}

export async function insertImages(editor: Editor, files: File[], upload: ImageUploader, position?: number) {
  const urls = await Promise.all(files.map(file => upload(file)))
  if (editor.isDestroyed) return
  const images = urls.filter((url): url is string => !!url).map(src => ({ type: 'image', attrs: { src } }))
  if (!images.length) return
  const at = Math.min(position ?? editor.state.selection.from, editor.state.doc.content.size)
  editor.chain().focus().insertContentAt(at, images).run()
}

export function imageFiles(data: DataTransfer | null | undefined): File[] {
  return Array.from(data?.files ?? []).filter(file => file.type.startsWith('image/'))
}

// ─── Copying out ─────────────────────────────────────────────

export function fragmentToHtml(editor: Editor, fragment: Fragment): string {
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment))
  return container.innerHTML
}

export function fragmentToMarkdown(editor: Editor, fragment: Fragment): string {
  return htmlToMarkdown(fragmentToHtml(editor, fragment))
}

function isPlainInline(slice: Slice): boolean {
  let plain = true
  slice.content.descendants((node) => {
    if (node.isText ? node.marks.length > 0 : node.type.name !== 'paragraph') plain = false
    return plain
  })
  return plain && slice.content.childCount <= 1
}

// ─── The extension ───────────────────────────────────────────

export const SmartClipboard = Extension.create<SmartClipboardOptions>({
  name: 'smartClipboard',
  // Ahead of the link extension's own paste handling.
  priority: 200,

  addOptions() {
    return { getUploader: () => undefined }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const { getUploader } = this.options
    // `view.pasteText` runs the paste handlers again, this one included.
    let replaying = false

    return [
      new Plugin({
        key: new PluginKey('smartClipboard'),
        props: {
          transformPastedHTML: html => cleanPastedHtml(html),

          clipboardTextSerializer(slice, view) {
            // Source and unformatted runs are copied as they are: Markdown
            // escaping would turn `snake_case` into `snake\_case`.
            if (view.state.selection.$from.parent.type.spec.code || isPlainInline(slice)) {
              return slice.content.textBetween(0, slice.content.size, '\n\n')
            }
            return fragmentToMarkdown(editor, slice.content)
          },

          handlePaste(view, event) {
            const data = event.clipboardData
            if (!data || replaying) return false

            const text = data.getData('text/plain')
            const html = data.getData('text/html')
            const { selection } = view.state
            const { $from, $to } = selection

            // Inside a code block the clipboard is source, not prose: it goes
            // in verbatim as text. Parsing it as Markdown or styled HTML would
            // split the block at blank lines, swallow `-->` arrows and `[]`
            // labels, or end the block early.
            if ($from.parent.type.spec.code && $from.sameParent($to)) {
              const raw = text || plainTextFromHtml(html)
              if (!raw) return false
              event.preventDefault()
              view.dispatch(view.state.tr.insertText(raw.replace(/\r\n?/g, '\n')).setMeta('paste', true))
              return true
            }

            // Paste-as-plain-text (Shift) is the way out of all of the below.
            if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false

            // A copied image. Office suites also put a picture of the copied
            // text on the clipboard, so text wins when there is any.
            const upload = getUploader()
            const images = imageFiles(data)
            if (upload && images.length && !text.trim()) {
              event.preventDefault()
              void insertImages(editor, images, upload)
              return true
            }

            const trimmed = text.trim()
            if (!trimmed) return false

            // A lone URL: over a selection it links the selection.
            if (URL_ONLY.test(trimmed)) {
              event.preventDefault()
              if (!selection.empty) editor.chain().focus().setLink({ href: trimmed }).run()
              else pasteHtml(view, markdownToHtml(`<${trimmed}>`))
              return true
            }

            const markdown = markdownToHtml(text)
            // Clipboard sources often provide Markdown tables as an HTML code
            // block. Prefer the plain-text table when Marked recognizes one.
            const isTable = /<table(?:\s|>)/.test(markdown)

            if (!isTable && isFormattedHtml(html)) return false

            const language = sourceLanguage(data)
            if (language && text.includes('\n')) {
              event.preventDefault()
              pasteCodeBlock(editor, text.replace(/\r\n?/g, '\n').replace(/\n+$/, ''), language)
              return true
            }

            if (isTable || looksLikeMarkdown(text)) {
              event.preventDefault()
              pasteHtml(view, markdown)
              return true
            }

            // Plain text under a meaningless HTML wrapper: ProseMirror's own
            // text paste, one paragraph per line.
            if (html) {
              event.preventDefault()
              replaying = true
              try {
                view.pasteText(text, event)
              } finally {
                replaying = false
              }
              return true
            }
            return false
          }
        }
      })
    ]
  }
})
