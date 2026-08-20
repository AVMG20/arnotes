// Server-side Markdown ⇄ note-HTML conversion.
//
// Notes are stored as the HTML the Tiptap editor produces, but agents speak
// Markdown, so every MCP tool converts on the way in and out. The browser
// utilities in `app/utils/markdown.ts` do the same job with the native DOM;
// here Turndown's DOM implementation stands in for it.
import { marked } from 'marked'
import TurndownService from 'turndown'
// The package ships its type declaration under the module name `domino` rather
// than the scoped name it is published under, so the import is typed here.
// @ts-expect-error -- see above
import dominoUntyped from '@mixmark-io/domino'

const domino = dominoUntyped as {
  createDocument(html?: string, force?: boolean): Document
}

function parseFragment(html: string) {
  return domino.createDocument(`<body>${html}</body>`, true)
}

function createTurndownService(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

  td.addRule('table', {
    filter: 'table',
    replacement(_content, node) {
      const rows = Array.from((node as HTMLTableElement).rows)
      const [headerRow, ...bodyRows] = rows
      if (!headerRow) return ''

      const toCellText = (cell: HTMLTableCellElement) => cell.textContent?.trim().replace(/\|/g, '\\|') ?? ''
      const toRow = (row: HTMLTableRowElement) => `| ${Array.from(row.cells).map(toCellText).join(' | ')} |`
      const toSeparator = (cell: HTMLTableCellElement) => {
        switch (cell.style.textAlign) {
          case 'left': return ':---'
          case 'center': return ':---:'
          case 'right': return '---:'
          default: return '---'
        }
      }

      const header = toRow(headerRow)
      const separator = `| ${Array.from(headerRow.cells).map(toSeparator).join(' | ')} |`
      const body = bodyRows.map(toRow)

      return `\n\n${[header, separator, ...body].join('\n')}\n\n`
    }
  })

  td.addRule('taskItem', {
    filter(node) {
      return node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem'
    },
    replacement(_content, node) {
      const el = node as HTMLElement
      const checked = el.getAttribute('data-checked') === 'true'
      // The item wraps its text in a label/checkbox pair Turndown would render
      // as noise, so only the content block is converted — through Turndown
      // again, so bold, links and code inside a checklist item survive.
      const body = el.querySelector('div, p')
      const inner = body
        ? createTurndownService().turndown(body.innerHTML).replace(/\s*\n+\s*/g, ' ').trim()
        : (el.textContent ?? '').trim()
      return `- [${checked ? 'x' : ' '}] ${inner}\n`
    }
  })

  td.addRule('fencedCode', {
    filter(node) {
      return node.nodeName === 'PRE' && !!node.firstChild && (node.firstChild as HTMLElement).nodeName === 'CODE'
    },
    replacement(_content, node) {
      const code = (node as HTMLElement).querySelector('code')
      const lang = (code?.className ?? '').match(/language-(\w+)/)?.[1] ?? ''
      return `\n\`\`\`${lang}\n${code?.textContent ?? ''}\n\`\`\`\n\n`
    }
  })

  td.addRule('highlight', {
    filter: ['mark'],
    replacement: content => content
  })

  return td
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Markdown → the HTML shape Tiptap round-trips, including its task-list markup. */
export function markdownToHtml(text: string): string {
  if (!text) return ''
  const raw = marked.parse(text, { async: false, gfm: true }) as string
  const doc = parseFragment(raw)

  for (const li of Array.from(doc.querySelectorAll('ul > li'))) {
    const input = li.querySelector('input[type="checkbox"]')
    if (!input) continue
    const checked = input.hasAttribute('checked')
    li.closest('ul')!.setAttribute('data-type', 'taskList')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(checked))
    input.remove()
    const content = li.innerHTML.trim()
    li.innerHTML = `<label><input type="checkbox"${checked ? ' checked' : ''}></label><div><p>${content}</p></div>`
  }

  return doc.body.innerHTML
}

/** Note HTML → Markdown, matching what the browser export produces. */
export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  return normalizeMarkdown(createTurndownService().turndown(html))
}

// `textContent` runs adjacent blocks together, which would join a heading to the
// paragraph below it into one word. Closing block tags become spaces first.
const CLOSING_BLOCK_TAG = /<\/(?:h[1-6]|p|div|li|ul|ol|tr|td|th|blockquote|pre|section|article)>/gi

/** Plain text of a note, used for matching search terms without HTML noise. */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  const spaced = html.replace(CLOSING_BLOCK_TAG, match => `${match} `)
  return (parseFragment(spaced).body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// Mirrors `extractTags` in app/composables/useNotes.ts: tags live inline in the
// body as #hashtags, so they must be re-derived from content on every write.
export function extractTags(html: string): string[] {
  const cleaned = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '')
    .replace(/<[^>]+>/g, ' ')
  const matches = cleaned.match(/#([a-zA-Z][a-zA-Z0-9_]*)/g) ?? []
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))]
}

/** Mirrors `extractTitle` in app/composables/useNotes.ts. */
export function extractTitle(html: string): string {
  if (!html) return 'Untitled'
  const doc = parseFragment(html)
  const first = doc.querySelector('h1,h2,h3,h4,p,li,blockquote,pre')
  const text = ((first ?? doc.body).textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 80) || 'Untitled'
}

/**
 * Puts the title in front of the body as its own heading, leaving whatever the
 * body already contains untouched. This is how `createNote` in the app builds a
 * new note.
 */
export function prependTitle(html: string, title: string): string {
  return `<h1>${escapeHtmlText(title)}</h1>` + html
}

/** Mirrors `setTitleInContent` in app/composables/useNotes.ts. */
export function setTitleInContent(html: string, title: string): string {
  const doc = parseFragment(html)
  const heading = doc.querySelector('h1,h2,h3,h4')
  if (heading) heading.textContent = title
  else doc.body.insertAdjacentHTML('afterbegin', `<h1>${escapeHtmlText(title)}</h1>`)
  return doc.body.innerHTML
}

const TAG_PARAGRAPH = /^#([a-zA-Z][a-zA-Z0-9_]*)$/

function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/^#/, '').toLowerCase()
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(cleaned) ? cleaned : null
}

/**
 * Replaces a note's tag list. Tags live in the body as `#hashtags`, so the
 * standalone tag paragraphs the app writes are dropped and the requested set is
 * appended in their place. Tags written inline in prose are part of the text and
 * are deliberately left alone.
 */
export function setNoteTags(html: string, tags: string[]): string {
  const doc = parseFragment(html)

  for (const p of Array.from(doc.querySelectorAll('p'))) {
    if (TAG_PARAGRAPH.test((p.textContent ?? '').trim())) p.remove()
  }

  const wanted = [...new Set(tags.map(normalizeTag).filter((tag): tag is string => tag !== null))]
  const inline = new Set(extractTags(doc.body.innerHTML))
  const missing = wanted.filter(tag => !inline.has(tag))

  return doc.body.innerHTML + missing.map(tag => `<p>#${tag}</p>`).join('')
}
