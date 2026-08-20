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
  // Collapse 3+ blank lines into a single blank line
  result = result.replace(/\n{3,}/g, '\n\n')
  // Trim trailing whitespace per line
  result = result.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
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
  td.addRule('highlight', {
    filter: ['mark'],
    replacement: content => content
  })
  return td
}

export function markdownToHtml(text: string): string {
  const raw = marked.parse(text, { async: false, gfm: true }) as string
  if (!import.meta.client) return raw
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('ul > li').forEach((li) => {
    const input = li.querySelector('input[type="checkbox"]')
    if (!input) return
    const checked = (input as HTMLInputElement).checked
    li.closest('ul')!.setAttribute('data-type', 'taskList')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(checked))
    input.remove()
    const content = li.innerHTML.trim()
    li.innerHTML = `<label><input type="checkbox"${checked ? ' checked' : ''}></label><div><p>${content}</p></div>`
  })
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
