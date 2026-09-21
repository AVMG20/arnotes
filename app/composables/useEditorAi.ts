import { ref, type ComputedRef } from 'vue'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { markdownToHtml, htmlToMarkdown, normalizeAiOutput } from '~/utils/markdown'
import { fragmentToHtml } from '~/utils/editor/clipboard'
import { setAiPending, type AiPending } from '~/utils/editor/decorations'
import { runAi, runCustomAi } from '~/composables/useAi'
import { useUserSettings } from '~/composables/useUserSettings'

// The editor's two AI features: rewriting the selection with a preset action,
// and generating new content at the caret from a free-form prompt. Both stream
// into the document as they arrive and land as a single undo step.
export function useEditorAi(editor: ComputedRef<Editor | undefined>) {
  const toast = useToast()
  const { openrouterApiKey } = useUserSettings()

  const loading = ref(false)
  const promptOpen = ref(false)
  const promptPosition = ref<number | null>(null)

  function hasKey(): boolean {
    if (openrouterApiKey.value) return true
    toast.add({
      title: 'No OpenRouter API key',
      description: 'Add your key in Settings → AI to use AI features.',
      icon: 'i-lucide-key-round',
      color: 'error',
      duration: 4000
    })
    return false
  }

  function reportFailure(error: unknown) {
    const err = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: 'AI request failed',
      description: err?.data?.message ?? err?.message ?? 'Unknown error',
      icon: 'i-lucide-alert-triangle',
      color: 'error',
      duration: 5000
    })
  }

  async function stream(
    ed: Editor,
    pending: AiPending,
    request: (onChunk: (result: string) => void) => Promise<string>,
    rollbackHtml = ''
  ) {
    const range = { from: pending.from, to: pending.to }
    let rendered = ''

    ed.view.dispatch(closeHistory(ed.state.tr))

    const replaceRange = (output: string, addToHistory: boolean) => {
      if (!output || output === rendered) return

      const previousSize = ed.state.doc.content.size
      ed.chain()
        .setMeta('addToHistory', addToHistory)
        .insertContentAt(range, markdownToHtml(output))
        .run()
      range.to += ed.state.doc.content.size - previousSize
      rendered = output
      setAiPending(ed, pending.kind === 'generate'
        ? { kind: 'generate', from: range.to, to: range.to }
        : { kind: 'transform', ...range })
    }

    const renderChunk = (markdown: string) => {
      try {
        replaceRange(markdown, false)
      } catch {
        // Partial markdown such as "- " can briefly produce an invalid empty node.
      }
    }

    const restoreOriginal = () => {
      const previousSize = ed.state.doc.content.size
      const chain = ed.chain().setMeta('addToHistory', false)
      if (rollbackHtml) chain.insertContentAt(range, rollbackHtml)
      else if (range.from < range.to) chain.deleteRange(range)
      chain.run()
      range.to += ed.state.doc.content.size - previousSize
      rendered = ''
    }

    try {
      const result = await request(renderChunk)
      restoreOriginal()
      ed.view.dispatch(closeHistory(ed.state.tr))
      replaceRange(normalizeAiOutput(result), true)
      ed.commands.focus(range.to)
    } catch (error) {
      restoreOriginal()
      throw error
    }
  }

  async function run(ed: Editor, pending: AiPending, request: Parameters<typeof stream>[2], rollbackHtml = '') {
    loading.value = true
    setAiPending(ed, pending)
    try {
      await stream(ed, pending, request, rollbackHtml)
      return true
    } catch (error) {
      reportFailure(error)
      return false
    } finally {
      if (!ed.isDestroyed) setAiPending(ed, null)
      loading.value = false
    }
  }

  async function transformSelection(action: string) {
    const ed = editor.value
    if (!ed || loading.value || !hasKey()) return
    const { from, to } = ed.state.selection
    if (from === to) return
    const selectionHtml = fragmentToHtml(ed, ed.state.doc.slice(from, to).content)
    if (!selectionHtml.trim()) return
    const text = htmlToMarkdown(selectionHtml)

    await run(ed, { kind: 'transform', from, to }, onChunk => runAi(action, text, '', onChunk), selectionHtml)
  }

  function openPrompt(ed: Editor) {
    promptPosition.value = ed.state.selection.from
    promptOpen.value = true
  }

  // Resolves to whether the content was generated, so the prompt can be kept
  // for another try when it was not.
  async function generate(instruction: string, includeContext: boolean): Promise<boolean> {
    const ed = editor.value
    if (!ed || !instruction || loading.value || !hasKey()) return false

    const position = Math.min(promptPosition.value ?? ed.state.selection.from, ed.state.doc.content.size)
    const context = includeContext ? htmlToMarkdown(ed.getHTML()).trim() : ''
    promptOpen.value = false
    const done = await run(ed, { kind: 'generate', from: position, to: position }, onChunk => runCustomAi(instruction, context, onChunk))
    if (done) promptPosition.value = null
    return done
  }

  return { loading, promptOpen, transformSelection, openPrompt, generate }
}
