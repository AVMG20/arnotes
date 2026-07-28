import MiniSearch from 'minisearch'
import { initNotesStore } from '~/composables/useNotes'
import type { Note } from '~/composables/useNotes'
import { authClient } from '~/composables/useAuth'

type SearchDoc = Note & { tagsText: string, contentText: string }

export default defineNuxtPlugin(async () => {
  const { data: session } = await authClient.getSession()
  if (!session) return

  let notes: Note[]
  try {
    notes = await $fetch<Note[]>('/api/notes')
  } catch {
    return
  }

  const search = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: ['title', 'tagsText', 'contentText'],
    storeFields: ['id', 'title', 'tags', 'updatedAt'],
    searchOptions: {
      boost: { tagsText: 3, title: 2 },
      prefix: true,
      fuzzy: 0.2
    }
  })

  // Seed a welcome note on first launch
  if (notes.length === 0) {
    const welcome = await $fetch<Note>('/api/notes', {
      method: 'POST',
      body: {
        title: 'Welcome to Notes',
        content: [
          '<h1>Welcome to Notes</h1>',
          '<p>Start writing here. Use <strong>#tags</strong> to organize your notes.</p>',
          '<p>Type <code>#work</code>, <code>#personal</code>, or any <code>#tag</code> to categorize this note. The sidebar updates automatically.</p>',
          '<pre><code class="language-javascript">// Code highlighting works out of the box!\nconst greet = (name) => `Hello, ${name}`\nconsole.log(greet("developer"))</code></pre>'
        ].join(''),
        tags: ['welcome']
      }
    })
    notes.unshift(welcome)
  }

  initNotesStore(notes, search)
})
