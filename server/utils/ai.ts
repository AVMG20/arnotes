import { AI_SETTINGS_DEFAULTS } from '../db/schema'

export type AiAction
  = | 'improve-grammar'
    | 'fix-spelling'
    | 'make-shorter'
    | 'make-longer'
    | 'simplify'
    | 'make-professional'
    | 'make-casual'
    | 'make-task-list'
    | 'summarize'
    | 'generate-outline'
    | 'continue-writing'
    | 'brainstorm'
    | 'make-task-list-from-note'
    | 'custom'

const FORMAT_INSTRUCTION = 'Use standard markdown formatting only (headings with #, bold with **, italic with *, bullet lists with -, numbered lists, task lists with - [ ], code blocks with ```, and tables with a header row followed by a | --- | separator row). Escape literal pipes in table cells as \\|. Do NOT use LaTeX notation (no $...$ or \\commands). Use plain unicode for arrows (→) and other symbols.'

const PROMPTS: Record<AiAction, string> = {
  'improve-grammar': `Improve the grammar of the given text in the same language the text was given. Only respond with the improved text. Try and keep it close to the original text but feel free to make it better readable. Preserve all markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'fix-spelling': `Fix any spelling mistakes in the given text. Keep the same language, meaning, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'make-shorter': `Make the given text more concise while keeping the same meaning, language, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'make-longer': `Expand the given text with more detail while keeping the same meaning, tone, language, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'simplify': `Rewrite the given text to be simpler and easier to understand, keeping the same language, meaning, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'make-professional': `Rewrite the given text in a more professional tone, keeping the same language, meaning, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'make-casual': `Rewrite the given text in a more casual, friendly tone, keeping the same language, meaning, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'make-task-list': `Convert the given text into a task list (checklist). Use markdown checklist syntax (- [ ] item). Keep the same language. Only respond with the task list, nothing else. ${FORMAT_INSTRUCTION}\n\nText:\n{text}`,
  'summarize': `Summarize the following note into the most important key points. Use markdown formatting (headings, bullet points, bold). Keep the same language as the note. Only respond with the summary, nothing else. ${FORMAT_INSTRUCTION}\n\nNote:\n{context}`,
  'generate-outline': `Generate a clear outline for a note based on the following content. Use markdown headings (# / ## / ###). Keep the same language. Only respond with the outline, nothing else. ${FORMAT_INSTRUCTION}\n\nContent:\n{context}`,
  'continue-writing': `Continue writing from where the following text ends. Keep the same style, tone, language, and markdown formatting (headings, lists, bold, italic, code blocks, etc.). ${FORMAT_INSTRUCTION}\n\nText:\n{context}`,
  'brainstorm': `Brainstorm ideas related to the following note. Return a markdown bullet list of concrete, actionable ideas. Keep the same language. Only respond with the list, nothing else. ${FORMAT_INSTRUCTION}\n\nNote:\n{context}`,
  'make-task-list-from-note': `Convert the following note into a task list of actionable items. Use markdown checklist syntax (- [ ] item). Keep the same language. Only respond with the task list, nothing else. ${FORMAT_INSTRUCTION}\n\nNote:\n{context}`,
  'custom': `Follow the user's instruction and produce content that can be inserted directly into their note. Return only the requested content, without commentary about the request. ${FORMAT_INSTRUCTION}\n\nUser instruction:\n{instruction}\n\nCurrent note for context (may be empty):\n{context}`
}

export function buildPrompt(action: AiAction, text: string, context: string, instruction = ''): string {
  const template = PROMPTS[action] ?? PROMPTS['improve-grammar']
  return template.replace('{text}', text).replace('{context}', context).replace('{instruction}', instruction)
}

export const DEFAULT_OPENROUTER_MODEL = AI_SETTINGS_DEFAULTS.openrouterModel

interface OpenRouterStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost?: number
  }
  error?: { message?: string }
}

interface OpenRouterErrorResponse {
  error?: { message?: string, metadata?: unknown }
  message?: string
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
}

export async function streamOpenRouter(apiKey: string, model: string, prompt: string, onComplete?: (usage: AiUsage) => Promise<void>): Promise<ReadableStream<Uint8Array>> {
  const requestCompletion = (reasoning: { effort?: 'none', exclude: true }) => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://arnotes.local',
      'X-Title': 'Arnotes',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      reasoning,
      stream: true,
      stream_options: { include_usage: true }
    })
  })

  let res: Response
  try {
    // `none` disables configurable reasoning (including Tencent HY3).
    res = await requestCompletion({ effort: 'none', exclude: true })

    // Mandatory-thinking models reject `effort: none`. Retry once with reasoning
    // hidden from the editor instead, so those models remain usable.
    if (!res.ok && [400, 422, 500].includes(res.status)) {
      console.warn('[AI] Retrying without disabled reasoning', { model, status: res.status, statusText: res.statusText })
      res = await requestCompletion({ exclude: true })
    }
  } catch (error) {
    console.error('[AI] Unable to reach OpenRouter', { model, error })
    throw createError({ statusCode: 502, message: 'Could not reach OpenRouter. Check the server connection and try again.' })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as OpenRouterErrorResponse | null
    const message = body?.error?.message ?? body?.message ?? `OpenRouter request failed (${res.status})`
    console.error('[AI] OpenRouter request failed', {
      model,
      status: res.status,
      statusText: res.statusText,
      requestId: res.headers.get('x-request-id'),
      error: body
    })
    throw createError({ statusCode: 502, message })
  }
  if (!res.body) {
    console.error('[AI] OpenRouter returned no response body', { model, requestId: res.headers.get('x-request-id') })
    throw createError({ statusCode: 502, message: 'OpenRouter returned an empty response.' })
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let completed = false
  let usage: AiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }

  return res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, '')
        if (!data || !line.trim().startsWith('data:')) continue
        if (data === '[DONE]') {
          completed = true
          continue
        }

        let event: OpenRouterStreamChunk
        try {
          event = JSON.parse(data) as OpenRouterStreamChunk
        } catch (error) {
          console.error('[AI] Invalid OpenRouter stream event', { model, eventLength: data.length, error })
          throw new Error('The model returned an invalid response.')
        }
        if (event.error) {
          const message = event.error.message ?? 'OpenRouter error'
          console.error('[AI] OpenRouter stream failed', { model, error: event.error })
          throw new Error(message)
        }
        if (event.usage) {
          usage = {
            inputTokens: event.usage.prompt_tokens ?? 0,
            outputTokens: event.usage.completion_tokens ?? 0,
            totalTokens: event.usage.total_tokens ?? 0,
            cost: event.usage.cost ?? 0
          }
        }
        const content = event.choices?.[0]?.delta?.content
        if (content) controller.enqueue(encoder.encode(content))
      }
    },
    async flush() {
      if (!completed) {
        console.error('[AI] OpenRouter stream ended before completion', { model })
        throw new Error('The model stopped responding before completing the request.')
      }
      await onComplete?.(usage)
    }
  }))
}
