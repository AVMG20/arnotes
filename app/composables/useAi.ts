export interface AiActionDef {
  id: string
  label: string
  icon: string
  kind: 'transform' | 'generate'
  description?: string
}

export const AI_ACTIONS: AiActionDef[] = [
  // Actions that transform a text selection
  { id: 'improve-grammar', label: 'Improve grammar', icon: 'i-lucide-spell-check', kind: 'transform', description: 'Fix grammar & readability' },
  { id: 'fix-spelling', label: 'Fix spelling', icon: 'i-lucide-case-lower', kind: 'transform' },
  { id: 'make-shorter', label: 'Make shorter', icon: 'i-lucide-minimize-2', kind: 'transform' },
  { id: 'make-longer', label: 'Make longer', icon: 'i-lucide-maximize-2', kind: 'transform' },
  { id: 'simplify', label: 'Simplify', icon: 'i-lucide-feather', kind: 'transform' },
  { id: 'make-professional', label: 'Make professional', icon: 'i-lucide-briefcase', kind: 'transform' },
  { id: 'make-casual', label: 'Make casual', icon: 'i-lucide-coffee', kind: 'transform' },
  { id: 'make-task-list', label: 'Make task list', icon: 'i-lucide-list-checks', kind: 'transform' },
  // Actions that generate from the whole note
  { id: 'summarize', label: 'Summarize note', icon: 'i-lucide-file-text', kind: 'generate' },
  { id: 'generate-outline', label: 'Generate outline', icon: 'i-lucide-list-tree', kind: 'generate' },
  { id: 'continue-writing', label: 'Continue writing', icon: 'i-lucide-pen-line', kind: 'generate' },
  { id: 'brainstorm', label: 'Brainstorm ideas', icon: 'i-lucide-lightbulb', kind: 'generate' },
  { id: 'make-task-list-from-note', label: 'Tasks from note', icon: 'i-lucide-list-checks', kind: 'generate' }
]

export function getAiAction(id: string): AiActionDef | undefined {
  return AI_ACTIONS.find(a => a.id === id)
}

export const transformActions = AI_ACTIONS.filter(a => a.kind === 'transform')
export const generateActions = AI_ACTIONS.filter(a => a.kind === 'generate')

export interface AiResult {
  result: string
  model: string
}

export async function runAi(action: string, text: string, context: string): Promise<AiResult> {
  return await $fetch<AiResult>('/api/ai', { method: 'POST', body: { action, text, context } })
}
