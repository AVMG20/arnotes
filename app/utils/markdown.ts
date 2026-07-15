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
  td.addRule('taskItem', {
    filter(node) {
      return node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem'
    },
    replacement(_content, node) {
      const el = node as HTMLElement
      const checked = el.getAttribute('data-checked') === 'true'
      const text = (el.querySelector('div, p')?.textContent ?? '').trim()
      return `- [${checked ? 'x' : ' '}] ${text}\n`
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
  const raw = marked.parse(text, { async: false }) as string
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
