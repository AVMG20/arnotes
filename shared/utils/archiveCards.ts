// Archive replies are prose with cards embedded in it. A card is a fenced block
// whose info string names rows the assistant is showing:
//
//     ```memory:m_abc
//     ```
//
//     ```todos:t_1,t_2,t_3
//     ```
//
// The fence carries ids and nothing else. That is the whole trick: a card is a
// reference, not a copy, so it draws from the live row and edits made in it go
// straight back to that row. Prose around the cards is the assistant talking —
// read-only, and disposable.
//
// Same shape as the ```mermaid and ```chart fences the note editor already
// draws, so a reply can mix all four.

export type ArchiveSegment
  = | { kind: 'prose', text: string }
    | { kind: 'card', card: 'memory' | 'todos', ids: string[] }
    | { kind: 'diagram', language: 'chart' | 'mermaid', code: string }

const CARD_OPEN = /^\s*```\s*(memory|todos):([A-Za-z0-9_,\s-]+?)\s*$/i
const DIAGRAM_OPEN = /^\s*```\s*(chart|mermaid)\s*$/i
const FENCE_CLOSE = /^\s*```\s*$/

function parseIds(raw: string): string[] {
  return [...new Set(raw.split(',').map(id => id.trim()).filter(Boolean))]
}

/**
 * Splits a reply into prose, cards and diagrams. A fence that has not been
 * closed yet stays prose, so a reply that is still streaming never flashes a
 * half-built card.
 */
export function parseArchiveSegments(text: string): ArchiveSegment[] {
  const lines = text.split('\n')
  const out: ArchiveSegment[] = []
  let prose: string[] = []

  const flushProse = () => {
    const joined = prose.join('\n')
    if (joined.trim()) out.push({ kind: 'prose', text: joined })
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const card = CARD_OPEN.exec(line)
    const diagram = card ? null : DIAGRAM_OPEN.exec(line)
    if (!card && !diagram) {
      prose.push(line)
      continue
    }

    const close = lines.findIndex((candidate, j) => j > i && FENCE_CLOSE.test(candidate))
    if (close === -1) {
      prose.push(line)
      continue
    }

    flushProse()
    if (card) {
      const ids = parseIds(card[2]!)
      // An empty id list is a typo on the model's part, not a card.
      if (ids.length) {
        out.push({ kind: 'card', card: card[1]!.toLowerCase() as 'memory' | 'todos', ids })
      }
    } else {
      out.push({
        kind: 'diagram',
        language: diagram![1]!.toLowerCase() as 'chart' | 'mermaid',
        code: lines.slice(i + 1, close).join('\n')
      })
    }
    i = close
  }

  flushProse()
  return out
}

/** Every row id a reply points at, so the cards can be fetched in one request. */
export function extractCardIds(text: string): { memoryIds: string[], todoIds: string[] } {
  const memoryIds = new Set<string>()
  const todoIds = new Set<string>()
  for (const segment of parseArchiveSegments(text)) {
    if (segment.kind !== 'card') continue
    const target = segment.card === 'memory' ? memoryIds : todoIds
    for (const id of segment.ids) target.add(id)
  }
  return { memoryIds: [...memoryIds], todoIds: [...todoIds] }
}

/**
 * Flattens cards to bare references for replay to the model.
 *
 * A stored reply must never be quoted back as text: the row it points at has
 * probably changed since — that is the entire point of a card being editable —
 * and re-sending bodies the model can already see in the index is what makes a
 * long conversation expensive. The reference is enough; the assistant recalls
 * the row if it needs the contents.
 */
export function stripCardBodies(text: string): string {
  const out: string[] = []
  for (const segment of parseArchiveSegments(text)) {
    if (segment.kind === 'prose') out.push(segment.text)
    else if (segment.kind === 'card') out.push(`[${segment.card}:${segment.ids.join(',')}]`)
    else out.push('```' + segment.language + '\n' + segment.code + '\n```')
  }
  return out.join('\n').trim()
}
