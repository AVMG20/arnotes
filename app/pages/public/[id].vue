<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createLowlight, common } from 'lowlight'
import { DateMention } from '~/composables/useDateMention'

import TurndownService from 'turndown'

const route = useRoute()
const router = useRouter()
const toast = useToast()

interface PublicNote {
  id: string
  title: string
  content: string
  tags: string[]
  updatedAt: number
}

const note = ref<PublicNote | null>(null)
const error = ref(false)
const isLoggedIn = ref(false)

onMounted(async () => {
  const { authClient } = await import('~/composables/useAuth')
  const { data: session } = await authClient.getSession()
  isLoggedIn.value = !!session

  try {
    note.value = await $fetch<PublicNote>(`/api/public/${route.params.id}`)
  } catch {
    error.value = true
  }
})

function goHome() {
  router.push(isLoggedIn.value ? '/note' : '/login')
}

// ─── Editor extensions (same as NotesEditor, without HashtagHighlight) ───

const lowlight = createLowlight(common)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extensions: any[] = [
  CodeBlockLowlight.configure({ lowlight }).extend({
    addNodeView: () => VueNodeViewRenderer(CodeBlockView)
  }),
  Highlight.configure({ multicolor: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  DateMention,
]

const editorContent = ref('')

watch(note, (n) => {
  if (n) editorContent.value = n.content
})

function copyToMarkdown() {
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
    replacement: (content) => content
  })
  navigator.clipboard.writeText(td.turndown(editorContent.value)).then(() => {
    toast.add({ title: 'Copied as Markdown', icon: 'i-lucide-clipboard-check', duration: 2000 })
  })
}
</script>

<template>
  <div class="flex flex-col h-screen overflow-hidden bg-default">
    <!-- Top navbar -->
    <div class="border-b border-default shrink-0 bg-default">
      <UContainer class="flex gap-3 py-3">
        <div class="px-10 flex items-center justify-between w-full">
          <button class="flex items-center gap-2 hover:opacity-75 transition-opacity" @click="goHome">
            <AppLogo class="text-xl" />
          </button>
          <div class="flex items-center gap-3">
            <UButton
              v-if="note"
              icon="i-lucide-clipboard-copy"
              label="Copy Markdown"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="copyToMarkdown"
            />
          </div>
        </div>

      </UContainer>
    </div>

    <!-- Error state -->
    <template v-if="error">
      <div class="flex flex-col items-center justify-center flex-1 gap-3 text-center px-8">
        <UIcon name="i-lucide-file-x" class="size-12 text-muted" />
        <p class="text-muted text-sm">This note is not available or has been made private.</p>
        <UButton
          :label="isLoggedIn ? 'Go to my notes' : 'Go to app'"
          color="primary"
          variant="soft"
          size="sm"
          @click="goHome"
        />
      </div>
    </template>

    <!-- Loading state -->
    <template v-else-if="!note">
      <div class="flex items-center justify-center flex-1">
        <UIcon name="i-lucide-loader-circle" class="size-6 text-muted animate-spin" />
      </div>
    </template>

    <!-- Note content -->
    <template v-else>
      <div class="flex-1 overflow-y-auto">
        <UContainer>
          <UEditor
            v-model="editorContent"
            content-type="html"
            :editable="false"
            :starter-kit="{ codeBlock: false }"
            :extensions="extensions"
            class="min-h-full"
          />
        </UContainer>
      </div>
    </template>
  </div>
</template>
