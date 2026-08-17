import type { ChatMessage } from '~/composables/useAiChat'

// Chat-completion APIs reject a history where an assistant `tool_calls` entry
// is missing its results, or a tool result has no parent call — exactly what an
// aborted round, a failed request or a restored session leaves behind. This
// rebuilds the wire format from complete pairs only.
export function toWireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const resolved = new Set(
    messages
      .filter(m => m.role === 'tool' && !m.pending && m.toolCallId)
      .map(m => m.toolCallId!)
  )
  const declared = new Set<string>()
  const wire: Array<Record<string, unknown>> = []

  for (const m of messages) {
    if (m.pending) continue

    if (m.role === 'user') {
      if (m.content.trim()) wire.push({ role: 'user', content: m.content })
      continue
    }

    if (m.role === 'assistant') {
      if (m.error) continue
      const calls = (m.toolCalls ?? []).filter(c => resolved.has(c.id))
      if (calls.length > 0) {
        for (const c of calls) declared.add(c.id)
        wire.push({ role: 'assistant', content: m.content || null, tool_calls: calls })
      } else if (m.content.trim()) {
        wire.push({ role: 'assistant', content: m.content })
      }
      continue
    }

    if (m.toolCallId && declared.has(m.toolCallId)) {
      wire.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return wire
}
