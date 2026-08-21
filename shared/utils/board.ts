// Board facts derived from data that already exists, shared by the client and
// the API so both answer the same way.

// ─── Terminal columns ─────────────────────────────────────────────────────────

// Columns are the user's to name, so "how many are still open" has to be a
// guess. A column whose name reads as an ending is one; failing that the last
// column is, because that is where boards put their finished work. A board with
// a single column has no ending to speak of and reports a plain total.
const TERMINAL_COLUMN_PATTERN = /done|shipped|complete|closed|live|cancel|reject|dropped|archive/i

export function terminalColumnIds<T extends { id: string, name: string }>(columnsInOrder: T[]): string[] {
  if (columnsInOrder.length < 2) return []
  const named = columnsInOrder.filter(column => TERMINAL_COLUMN_PATTERN.test(column.name))
  if (named.length) return named.map(column => column.id)
  return [columnsInOrder[columnsInOrder.length - 1]!.id]
}

/** `8/47` once a board has an ending to measure against, otherwise just `47`. */
export function taskCountLabel(open: number, total: number, hasTerminalColumn: boolean): string {
  return hasTerminalColumn ? `${open}/${total}` : String(total)
}

// ─── Checklist progress ───────────────────────────────────────────────────────

export interface ChecklistProgress {
  done: number
  total: number
}

// The editor's task lists are already subtasks; counting them costs nothing and
// adds no field to fill in. Tiptap writes every item as
// `<li data-type="taskItem" data-checked="true|false">`, in either attribute
// order, which is what both the app and the MCP markdown bridge round-trip.
const TASK_ITEM_TAG = /<li\b[^>]*\bdata-type="taskItem"[^>]*>/gi

export function checklistProgress(html: string): ChecklistProgress | null {
  if (!html || !html.includes('taskItem')) return null
  let done = 0
  let total = 0
  for (const tag of html.match(TASK_ITEM_TAG) ?? []) {
    total++
    if (/\bdata-checked="true"/i.test(tag)) done++
  }
  return total ? { done, total } : null
}

// ─── Due dates ────────────────────────────────────────────────────────────────

const DATE_MENTION_ATTR = /\bdata-date-mention="([^"]+)"/gi

/**
 * The date a task is working towards, read off the `@date` mentions already in
 * its description — no due-date field to set, clear or keep in sync. The
 * soonest date still ahead wins; with none left ahead, the most recent one
 * behind is what the task is late for.
 */
export function taskDueDate(html: string, now = Date.now()): number | null {
  if (!html || !html.includes('data-date-mention')) return null

  let soonestAhead: number | null = null
  let latestBehind: number | null = null

  for (const [, iso] of html.matchAll(DATE_MENTION_ATTR)) {
    const at = new Date(iso!).getTime()
    if (Number.isNaN(at)) continue
    if (at >= now) {
      if (soonestAhead === null || at < soonestAhead) soonestAhead = at
    } else if (latestBehind === null || at > latestBehind) {
      latestBehind = at
    }
  }

  return soonestAhead ?? latestBehind
}
