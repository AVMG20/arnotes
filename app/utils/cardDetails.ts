import { checklistProgress, taskDueDate } from '#shared/utils/board'

// What a card reads out of its description — the snippet, the checklist and
// the due date — only changes when the description does. Kept across mounts,
// so opening a board again, or a re-read that hands back the same text, does
// not run every card's HTML through the same regexes again.
const DETAILS_CACHE_SIZE = 1000
const detailsCache = new Map<string, ReturnType<typeof readDescription>>()

function readDescription(description: string) {
  const snippet = description
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return { snippet, checklist: checklistProgress(description), due: taskDueDate(description) }
}

export function descriptionDetails(description: string) {
  let details = detailsCache.get(description)
  if (!details) {
    details = readDescription(description)
    detailsCache.set(description, details)
    if (detailsCache.size > DETAILS_CACHE_SIZE) detailsCache.delete(detailsCache.keys().next().value!)
  }
  return details
}
