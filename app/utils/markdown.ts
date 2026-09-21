import { marked } from 'marked'
import TurndownService from 'turndown'

// Common LaTeX math symbols that might survive in editor content
const LATEX_REPLACEMENTS: [RegExp, string][] = [
  [/\\rightarrow/g, '→'],
  [/\\leftarrow/g, '←'],
  [/\\Rightarrow/g, '⇒'],
  [/\\Leftarrow/g, '⇐'],
  [/\\leftrightarrow/g, '↔'],
  [/\\Leftrightarrow/g, '⇔'],
  [/\\to/g, '→'],
  [/\\rightarrow/g, '→'],
  [/\\cdot/g, '·'],
  [/\\times/g, '×'],
  [/\\pm/g, '±'],
  [/\\mp/g, '∓'],
  [/\\div/g, '÷'],
  [/\\leq/g, '≤'],
  [/\\geq/g, '≥'],
  [/\\neq/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\infty/g, '∞'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\delta/g, 'δ'],
  [/\\pi/g, 'π'],
  [/\\sum/g, '∑'],
  [/\\prod/g, '∏'],
  [/\\sqrt/g, '√'],
  [/\\partial/g, '∂'],
  [/\\nabla/g, '∇'],
  [/\\degree/g, '°'],
  [/\\dots/g, '…'],
  [/\\ldots/g, '…'],
  [/\\cdots/g, '⋯']
]

function replaceLatex(text: string): string {
  let result = text
  for (const [pattern, replacement] of LATEX_REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }
  // Remove remaining inline math delimiters $...$ (keep content)
  result = result.replace(/\$([^$]+)\$/g, (_m, inner) => {
    // Run replacements on the inner content too
    let cleaned = inner
    for (const [pattern, replacement] of LATEX_REPLACEMENTS) {
      cleaned = cleaned.replace(pattern, replacement)
    }
    return cleaned
  })
  return result
}

function normalizeMarkdown(text: string): string {
  let result = text
  // Replace LaTeX artifacts with unicode
  result = replaceLatex(result)
  // Trim trailing whitespace per line
  result = result.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
  // Collapse 3+ blank lines into a single blank line
  result = result.replace(/\n{3,}/g, '\n\n')
  // Remove leading/trailing blank lines
  result = result.replace(/^\n+/, '').replace(/\n+$/, '')
  return result
}

export function createTurndownService(): TurndownService {
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
  // Tight lists with a single space after the marker (`- item`, `1. item`):
  // Turndown's own rule pads the marker to four columns, and the editor wraps
  // every item in a paragraph, which would otherwise read as a loose list.
  td.addRule('listItem', {
    filter: 'li',
    replacement(content, node) {
      const parent = node.parentNode as HTMLElement | null
      let marker = '- '
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1)
        const index = Array.from(parent.children).indexOf(node as Element)
        marker = `${start + index}. `
      }
      const indent = ' '.repeat(marker.length)
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n{2,}/g, '\n').replace(/\n/g, `\n${indent}`)
      return `${marker}${body}${node.nextSibling ? '\n' : ''}`
    }
  })
  td.addRule('taskItem', {
    filter(node) {
      return node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem'
    },
    replacement(_content, node) {
      const el = node as HTMLElement
      const checked = el.getAttribute('data-checked') === 'true'
      // Only the content block is converted — the label/checkbox pair around it
      // would come out as noise — and it goes through Turndown again so bold,
      // links and code inside a checklist item survive the copy.
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
  // `==text==` is the de facto Markdown for a highlight (Obsidian, Typora) and
  // what `markdownToHtml` reads back, so a highlight survives a round trip.
  td.addRule('highlight', {
    filter: ['mark'],
    replacement: content => content.trim() ? `==${content}==` : content
  })
  td.addRule('underline', {
    filter: ['u'],
    replacement: content => content
  })
  return td
}

// A checkbox list as other tools write it (Marked, GitHub, Notion: an `input`
// leading each `li`) rewritten into the task-list markup Tiptap parses. A list
// only converts when every item has a checkbox; a stray one is dropped instead.
export function convertTaskLists(root: ParentNode) {
  const checkboxOf = (li: Element) => {
    const input = li.querySelector('input[type="checkbox"]')
    if (!input || input.closest('li') !== li) return null
    return input as HTMLInputElement
  }

  root.querySelectorAll('ul').forEach((list) => {
    if (list.getAttribute('data-type') === 'taskList') return
    const items = Array.from(list.children).filter(child => child.tagName === 'LI')
    const boxes = items.map(checkboxOf)
    if (!items.length || !boxes.some(Boolean)) return
    if (!boxes.every(Boolean)) {
      boxes.forEach(box => box?.remove())
      return
    }

    list.setAttribute('data-type', 'taskList')
    items.forEach((li, index) => {
      const input = boxes[index]!
      const checked = input.checked || input.hasAttribute('checked')
      input.remove()
      // Nested lists stay children of the item, after its own text.
      const nested = Array.from(li.children).filter(child => child.tagName === 'UL' || child.tagName === 'OL')
      nested.forEach(child => child.remove())
      const text = li.innerHTML.trim()
      const body = /^<p[\s>]/i.test(text) ? text : `<p>${text}</p>`
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(checked))
      li.innerHTML = `<label><input type="checkbox"${checked ? ' checked' : ''}></label><div>${body}</div>`
      const content = li.lastElementChild!
      nested.forEach(child => content.appendChild(child))
    })
  })
}

// `==text==` → `<mark>`, which Marked has no syntax for.
marked.use({
  extensions: [{
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('=='),
    tokenizer(src: string) {
      const match = /^==(?=\S)([^\n]*?\S)==/.exec(src)
      if (!match) return undefined
      return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]!) }
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
    }
  }]
})

export function markdownToHtml(text: string): string {
  const raw = marked.parse(text, { async: false, gfm: true }) as string
  if (!import.meta.client) return raw
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  convertTaskLists(doc.body)
  return doc.body.innerHTML
}

export function htmlToMarkdown(html: string): string {
  if (!import.meta.client || !html) return html
  const md = createTurndownService().turndown(html)
  return normalizeMarkdown(md)
}

export function normalizeAiOutput(text: string): string {
  return normalizeMarkdown(text)
}

// ─── Untrusted markdown (AI chat answers) ────────────────────

const ALLOWED_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'I', 'INPUT', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'TABLE', 'TBODY',
  'TD', 'TH', 'THEAD', 'TR', 'UL'
])
const ALLOWED_ATTRS = new Set(['href', 'title', 'type', 'checked', 'disabled', 'align'])
const SAFE_URL = /^(https?:|mailto:|#|\/)/i

// Model output is rendered with v-html, so it is treated as untrusted: only a
// markdown-shaped subset of tags and attributes survives.
export function sanitizeHtml(html: string): string {
  if (!import.meta.client) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes)
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (!ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name)
      } else if ((name === 'href' || name === 'src') && !SAFE_URL.test(attr.value.trim())) {
        el.removeAttribute(attr.name)
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer nofollow')
    }
    if (el.tagName === 'INPUT') el.setAttribute('disabled', '')
  }
  return doc.body.innerHTML
}

export function renderChatMarkdown(text: string): string {
  if (!text) return ''
  return sanitizeHtml(marked.parse(text, { async: false, gfm: true, breaks: true }) as string)
}
