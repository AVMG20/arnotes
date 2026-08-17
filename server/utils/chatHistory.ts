export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: WireToolCall[]
  tool_call_id?: string
  name?: string
}

export const MAX_HISTORY = 40

// Trimming a conversation is not a plain slice: providers reject a history in
// which a tool result has no preceding assistant tool call. The window has to
// start on a complete turn, and any orphaned result is dropped.
export function trimHistory(messages: WireMessage[], max = MAX_HISTORY): WireMessage[] {
  let start = Math.max(0, messages.length - max)
  while (start < messages.length && messages[start]?.role === 'tool') start++

  const declared = new Set<string>()
  const trimmed: WireMessage[] = []
  for (const m of messages.slice(start)) {
    if (m.role === 'assistant') {
      for (const call of m.tool_calls ?? []) declared.add(call.id)
      trimmed.push(m)
    } else if (m.role === 'tool') {
      if (m.tool_call_id && declared.has(m.tool_call_id)) trimmed.push(m)
    } else {
      trimmed.push(m)
    }
  }
  return trimmed
}

// Only spec-compliant fields reach the provider: `name` on tool messages is not
// part of the chat-completions spec and some providers reject it outright.
export function toProviderMessages(history: WireMessage[]): WireMessage[] {
  return history.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content }
    }
    return {
      role: m.role,
      content: m.content ?? '',
      ...(m.tool_calls && { tool_calls: m.tool_calls })
    }
  })
}
