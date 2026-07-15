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

const FORMAT_INSTRUCTION = 'Use standard markdown formatting only (headings with #, bold with **, italic with *, bullet lists with -, numbered lists, task lists with - [ ], code blocks with ```). Do NOT use LaTeX notation (no $...$ or \\commands). Use plain unicode for arrows (→) and other symbols.'

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

export interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export async function callOpenRouter(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await $fetch<OpenRouterResponse>('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://arnotes.local',
      'X-Title': 'Arnotes',
      'Content-Type': 'application/json'
    },
    body: {
      model,
      messages: [{ role: 'user', content: prompt }]
    }
  })

  if (res.error) throw createError({ statusCode: 502, message: res.error.message ?? 'OpenRouter error' })
  const content = res.choices?.[0]?.message?.content
  if (!content) throw createError({ statusCode: 502, message: 'Empty response from model' })
  return content
}
