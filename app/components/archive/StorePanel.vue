<script setup lang="ts">
import { computed, ref } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'

// What Archive is holding, listed. The assistant still owns the store — nothing
// here creates a row — but seeing what it kept, and throwing out what it got
// wrong, should not cost a chat turn.
const {
  storeReady, liveMemories, forgottenMemories, liveTodos, openMemoryId,
  loadStore, openMemory, forgetMemory, restoreMemory, purgeMemory, saveTodo, dropTodo
} = useArchive()
const toast = useToast()

onMounted(() => loadStore())

const query = ref('')
const view = ref<'memories' | 'todos'>('memories')
const showForgotten = ref(false)

const needle = computed(() => query.value.trim().toLowerCase())

function matches(text: string, tags: string[] = []) {
  const n = needle.value
  if (!n) return true
  return text.toLowerCase().includes(n) || tags.some(tag => tag.toLowerCase().includes(n))
}

const memories = computed(() => liveMemories.value.filter(m => matches(`${m.title}\n${m.body}`, m.tags)))
const forgotten = computed(() => forgottenMemories.value.filter(m => matches(`${m.title}\n${m.body}`, m.tags)))
const todos = computed(() => liveTodos.value.filter(t => matches(t.title, t.tags)))
const openTodos = computed(() => todos.value.filter(t => !t.done))
const doneTodos = computed(() => todos.value.filter(t => t.done))

const VIEWS = [
  { key: 'memories', label: 'Memories', icon: 'i-lucide-brain' },
  { key: 'todos', label: 'Todos', icon: 'i-lucide-list-checks' }
] as const

const counts = computed(() => ({
  memories: liveMemories.value.length,
  todos: liveTodos.value.filter(t => !t.done).length
}))

// ─── Actions ────────────────────────────────────────────────────────────────

const pending = ref(new Set<string>())

async function run(id: string, work: () => Promise<unknown>, failure: string) {
  pending.value = new Set(pending.value).add(id)
  try {
    await work()
  } catch {
    toast.add({ title: failure, color: 'error' })
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}

function forget(id: string) {
  return run(id, () => forgetMemory(id), 'Could not forget that memory')
}

function restore(id: string) {
  return run(id, () => restoreMemory(id), 'Could not restore that memory')
}

const purgeTarget = ref<{ id: string, title: string } | null>(null)

async function confirmPurge() {
  const target = purgeTarget.value
  purgeTarget.value = null
  if (!target) return
  await run(target.id, () => purgeMemory(target.id), 'Could not delete that memory')
}

function toggleTodo(id: string, done: boolean) {
  return run(id, () => saveTodo(id, { done }), 'Could not update that todo')
}

function removeTodo(id: string) {
  return run(id, () => dropTodo(id), 'Could not remove that todo')
}

function overdue(dueAt: number) {
  return dueAt < Date.now()
}

function dueLabel(dueAt: number) {
  return relativeTime(dueAt)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 space-y-2 px-3 pb-2">
      <UInput
        v-model="query"
        icon="i-lucide-search"
        size="sm"
        placeholder="Filter what's stored…"
        class="w-full"
        :ui="{ base: 'bg-elevated/40' }"
      >
        <template
          v-if="query"
          #trailing
        >
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="link"
            aria-label="Clear filter"
            @click="query = ''"
          />
        </template>
      </UInput>

      <div class="grid grid-cols-2 gap-1 rounded-lg bg-elevated/60 p-1">
        <button
          v-for="entry in VIEWS"
          :key="entry.key"
          class="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
          :class="view === entry.key ? 'bg-default text-default shadow-sm' : 'text-muted hover:text-default'"
          @click="view = entry.key"
        >
          <UIcon
            :name="entry.icon"
            class="size-3.5 shrink-0"
          />
          {{ entry.label }}
          <span class="tabular-nums text-dimmed">{{ counts[entry.key] }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="!storeReady"
      class="flex flex-1 items-center justify-center py-10"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin text-muted"
      />
    </div>

    <!-- Memories -->
    <div
      v-else-if="view === 'memories'"
      class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
    >
      <p
        v-if="!memories.length && !forgotten.length"
        class="px-2 py-6 text-center text-xs text-dimmed"
      >
        {{ needle ? 'Nothing matches.' : 'Nothing stored yet. Tell Archive something worth keeping.' }}
      </p>

      <ul class="space-y-0.5">
        <li
          v-for="memory in memories"
          :key="memory.id"
        >
          <div
            class="group relative flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 transition-colors"
            :class="openMemoryId === memory.id ? 'bg-elevated ring-1 ring-inset ring-default' : 'hover:bg-elevated/60'"
            role="button"
            tabindex="0"
            @click="openMemory(memory.id)"
            @keydown.enter="openMemory(memory.id)"
          >
            <UIcon
              name="i-lucide-brain"
              class="mt-0.5 size-3.5 shrink-0 text-primary/80"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm leading-snug text-default">
                {{ memory.title }}
              </p>
              <p class="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-dimmed">
                <span class="shrink-0">{{ relativeTime(memory.updatedAt) }}</span>
                <span
                  v-if="memory.tags.length"
                  class="truncate"
                >· {{ memory.tags.slice(0, 3).map(t => `#${t}`).join(' ') }}</span>
              </p>
            </div>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="neutral"
              variant="ghost"
              class="-mr-1 -mt-0.5 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
              :loading="pending.has(memory.id)"
              aria-label="Forget memory"
              @click.stop="forget(memory.id)"
            />
          </div>
        </li>
      </ul>

      <!-- Forgotten: the assistant's soft deletes, kept in reach for a while. -->
      <div
        v-if="forgotten.length"
        class="mt-2 border-t border-default pt-2"
      >
        <button
          class="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-elevated/60 hover:text-default"
          @click="showForgotten = !showForgotten"
        >
          <UIcon
            :name="showForgotten ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 shrink-0"
          />
          Forgotten
          <span class="tabular-nums text-dimmed">{{ forgotten.length }}</span>
        </button>
        <ul
          v-if="showForgotten"
          class="mt-0.5 space-y-0.5"
        >
          <li
            v-for="memory in forgotten"
            :key="memory.id"
          >
            <div
              class="group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-elevated/60"
              :class="openMemoryId === memory.id ? 'bg-elevated ring-1 ring-inset ring-default' : ''"
              role="button"
              tabindex="0"
              @click="openMemory(memory.id)"
              @keydown.enter="openMemory(memory.id)"
            >
              <p class="min-w-0 flex-1 truncate text-sm text-dimmed line-through">
                {{ memory.title }}
              </p>
              <div class="-mr-1 flex shrink-0 items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                <UButton
                  icon="i-lucide-undo-2"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :loading="pending.has(memory.id)"
                  aria-label="Restore memory"
                  @click.stop="restore(memory.id)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  aria-label="Delete permanently"
                  @click.stop="purgeTarget = { id: memory.id, title: memory.title }"
                />
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Todos -->
    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
    >
      <p
        v-if="!todos.length"
        class="px-2 py-6 text-center text-xs text-dimmed"
      >
        {{ needle ? 'Nothing matches.' : 'No todos yet. Archive creates them from plans you tell it.' }}
      </p>

      <ul class="space-y-0.5">
        <li
          v-for="todo in openTodos"
          :key="todo.id"
          class="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-elevated/60"
        >
          <UCheckbox
            :model-value="todo.done"
            :disabled="pending.has(todo.id)"
            :aria-label="todo.title"
            @update:model-value="toggleTodo(todo.id, $event === true)"
          />
          <button
            class="min-w-0 flex-1 truncate text-left text-sm text-default"
            :class="todo.memoryId ? 'cursor-pointer' : 'cursor-default'"
            :title="todo.memoryId ? 'Open the memory this came from' : undefined"
            @click="todo.memoryId && openMemory(todo.memoryId)"
          >
            {{ todo.title }}
          </button>
          <span
            v-if="todo.dueAt"
            class="shrink-0 text-xs"
            :class="overdue(todo.dueAt) ? 'text-error' : 'text-dimmed'"
          >{{ dueLabel(todo.dueAt) }}</span>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            class="-mr-1 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            aria-label="Remove todo"
            @click.stop="removeTodo(todo.id)"
          />
        </li>
      </ul>

      <div
        v-if="doneTodos.length"
        class="mt-2 border-t border-default pt-2"
      >
        <p class="px-2.5 pb-1 text-xs text-dimmed">
          Done <span class="tabular-nums">{{ doneTodos.length }}</span>
        </p>
        <ul class="space-y-0.5">
          <li
            v-for="todo in doneTodos"
            :key="todo.id"
            class="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-elevated/60"
          >
            <UCheckbox
              :model-value="todo.done"
              :disabled="pending.has(todo.id)"
              :aria-label="todo.title"
              @update:model-value="toggleTodo(todo.id, $event === true)"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-dimmed line-through">{{ todo.title }}</span>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              class="-mr-1 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
              aria-label="Remove todo"
              @click.stop="removeTodo(todo.id)"
            />
          </li>
        </ul>
      </div>
    </div>

    <UModal
      :open="!!purgeTarget"
      title="Delete permanently?"
      :description="`“${purgeTarget?.title ?? ''}” will be removed for good. Archive will not be able to recall it.`"
      :ui="{ footer: 'justify-end' }"
      @update:open="(value: boolean) => { if (!value) purgeTarget = null }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="purgeTarget = null"
        />
        <UButton
          label="Delete"
          color="error"
          @click="confirmPurge"
        />
      </template>
    </UModal>
  </div>
</template>
