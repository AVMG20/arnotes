// The narrow Markdown task updates are written in.
//
// An update is a line in a running log, not a document: it can emphasise a
// word, quote an identifier or link out, and that is the whole of it. So the
// grammar here stops at the marks that fit inside a sentence — bold, italic,
// inline code, strike, highlight and links — and never opens a block. Anything
// that would start a heading, a list or an image is left as the text the author
// typed. The task's description is where prose of that size belongs.
//
// Updates are stored as this Markdown, exactly as written, so an agent posting
// over MCP and a person typing in the drawer speak the same language and the
// stored row stays readable on its own. Rendering happens here, once, for both.

const ESCAPABLE = '\\`*_~=[]'

/** Escapes the characters that would otherwise read as a mark. */
export function escapeInlineMarkdown(text: string): string {
  return text.replace(/[\\`*_~=[\]]/g, ch => `\\${ch}`)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Only schemes a reader can safely be sent to. Anything else stays plain text,
// which matters because update bodies can come from an agent over MCP.
const SAFE_URL = /^(?:https?:\/\/|mailto:)/i
const BARE_URL = /^https?:\/\/[^\s<]*[^\s<.,:;"')\]]/i
const LINK = /^\[([^\]\n]*)\]\(([^()\s]+)\)/

const DELIMITERS: [marker: string, tag: string][] = [
  ['**', 'strong'],
  ['~~', 's'],
  ['==', 'mark'],
  ['*', 'em'],
  ['_', 'em']
]

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer nofollow"'

// The closing half of a delimiter, skipping over escaped characters so that
// `\*` inside an emphasis does not end it early.
function closingIndex(text: string, from: number, marker: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text.startsWith(marker, i)) return i
  }
  return -1
}

/**
 * Inline Markdown → HTML. The output is built tag by tag from escaped text, so
 * it carries nothing the author did not write and is safe to render directly.
 */
export function renderInlineMarkdown(text: string): string {
  if (!text) return ''

  let out = ''
  let i = 0

  while (i < text.length) {
    const ch = text[i]!

    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1]!)) {
      out += escapeHtml(text[i + 1]!)
      i += 2
      continue
    }

    if (ch === '\n') {
      out += '<br>'
      i++
      continue
    }

    // Code first: what is inside a span of code is text, not markup.
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        out += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`
        i = end + 1
        continue
      }
    }

    if (ch === '[') {
      const link = LINK.exec(text.slice(i))
      if (link && SAFE_URL.test(link[2]!)) {
        out += `<a href="${escapeHtml(link[2]!)}" ${LINK_ATTRS}>${renderInlineMarkdown(link[1] ?? '')}</a>`
        i += link[0].length
        continue
      }
    }

    // A URL pasted on its own, which is how most links arrive.
    if ((ch === 'h' || ch === 'H') && (i === 0 || /[\s([]/.test(text[i - 1]!))) {
      const bare = BARE_URL.exec(text.slice(i))
      if (bare) {
        out += `<a href="${escapeHtml(bare[0])}" ${LINK_ATTRS}>${escapeHtml(bare[0])}</a>`
        i += bare[0].length
        continue
      }
    }

    const delimiter = DELIMITERS.find(([marker]) => text.startsWith(marker, i))
    if (delimiter) {
      const [marker, tag] = delimiter
      const from = i + marker.length
      // `snake_case` is a word, not emphasis, so an underscore only opens one
      // at a word boundary. Emphasis also never opens or closes on a space.
      const wordBoundary = marker !== '_' || i === 0 || !/[\w]/.test(text[i - 1]!)
      if (wordBoundary && from < text.length && !/\s/.test(text[from]!)) {
        const end = closingIndex(text, from, marker)
        if (end > from && !/\s/.test(text[end - 1]!)) {
          out += `<${tag}>${renderInlineMarkdown(text.slice(from, end))}</${tag}>`
          i = end + marker.length
          continue
        }
      }
    }

    out += escapeHtml(ch)
    i++
  }

  return out
}

/** The same text with its marks taken off, for counts, titles and previews. */
export function inlineMarkdownToPlainText(text: string): string {
  return renderInlineMarkdown(text)
    .replace(/<br>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
