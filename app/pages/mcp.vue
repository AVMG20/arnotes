<script setup lang="ts">
definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'Connect an AI agent' })

const { sidebarOpen } = useSidebar()
const toast = useToast()

interface McpTool {
  name: string
  title: string
  description: string
  scope: string
}

const { data: catalog } = useFetch<{ tools: McpTool[] }>('/api/settings/mcp-tools', { server: false, lazy: true })
const tools = computed(() => catalog.value?.tools ?? [])

function scopeLabel(scope: string): string {
  const [feature, permission] = scope.split(':')
  return `${feature} ${permission}`
}

// Everything the user has to paste elsewhere needs the real origin of this install.
const origin = computed(() => (import.meta.client ? window.location.origin : ''))
const endpoint = computed(() => `${origin.value}/api/mcp`)

const claudeCodeCommand = computed(() =>
  `claude mcp add --transport http arnotes ${endpoint.value} \\\n  --header "Authorization: Bearer arn_your_key_here"`
)

const jsonConfig = computed(() => JSON.stringify({
  mcpServers: {
    arnotes: {
      type: 'http',
      url: endpoint.value,
      headers: { Authorization: 'Bearer arn_your_key_here' }
    }
  }
}, null, 2))

const curlCheck = computed(() =>
  `curl -X POST ${endpoint.value} \\\n`
  + `  -H "Authorization: Bearer arn_your_key_here" \\\n`
  + `  -H "Content-Type: application/json" \\\n`
  + `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
)

const skill = computed(() => `---
name: arnotes
description: Search, read and write the user's Arnotes notes and kanban boards through the Arnotes MCP server. Use whenever the user asks what they wrote down, refers to their notes or a #tag, or asks about their projects, boards or tasks.
---

# Working with Arnotes

Arnotes is the user's note-taking app, with kanban boards beside the notes. A
note has a title, a Markdown body and tags, and tags are written inline in the
body as \`#hashtags\`. A board has columns — kanban stages such as Backlog, To do,
Verify, Done — holding tasks; a task has a title, a Markdown description, labels
and a running log of short updates.

## Finding things

- Start with \`search_notes\`. Every word in the query has to appear in a note, so
  keep queries short — two or three words beats a sentence.
- \`list_tags\` shows which tags exist. Use it when the user names a topic and you
  are not sure what they tag it with.
- \`search_notes\` returns snippets, not full notes. Call \`get_note\` before
  summarising or quoting anything.

## Writing

- \`create_note\` takes a title and a Markdown body. Do not repeat the title as a
  heading in the body and do not write \`#tags\` by hand — pass \`tags\` instead.
- \`update_note\` replaces whole fields. Read the note first, edit the Markdown you
  got back, then send the complete new body. Never send a fragment.
- \`delete_note\` moves a note to the trash and \`restore_note\` brings it back.
  Nothing is ever permanently deleted, so prefer trashing over rewriting a note
  into oblivion.

## Boards

- \`list_boards\` then \`get_board\` gives you the board as it is drawn: columns in
  order, and in each the tasks with their title, labels and the first line of the
  description. Do that before creating or moving anything, so board, column and
  task names match what is really there.
- \`get_board\` stays small on purpose. Narrow it with \`columns\` when you only care
  about one stage, pass \`detail: 'titles'\` for a cheap overview, and read the one
  task you actually need with \`get_task\` — that is where the full description and
  the update thread live. \`detail: 'full'\` returns every description at once and
  is rarely what you want.
- \`create_task\` needs a board, a column and a title. Put detail in the Markdown
  description, not the title, and pass \`labels\` rather than writing them into
  the text. \`list_task_labels\` shows which labels already exist.
- \`move_task\` is how a task changes stage — moving it into Done is what
  "finished" means here. \`update_task\` replaces whole fields, so read the task
  first when editing part of a description.
- Pointing at one exact thing is easiest with a link: paste the URL of a note,
  a board, or a board with a task open (\`/projects/<id>?task=<id>\`) into
  \`get_note\`, \`get_board\` or \`get_task\` and it resolves to that resource — no
  title to describe, no id to retype.
- \`add_task_update\` posts a line on the task's log. Use it for progress,
  blockers and decisions the user will want to read later; keep it to a sentence
  or two.
- \`delete_column\` and \`delete_task\` move things to the board's trash rather
  than removing them; \`restore_column\` and \`restore_task\` undo either, and the
  user can do the same from **Show trashed** on the board. The trash empties
  itself after 7 days.
- There is no \`delete_board\`. Deleting a board takes its columns, tasks and
  updates with it, so it stays with the user in the app.
- Deleting is still rarely the answer: a finished task belongs in Done via
  \`move_task\`. Say what you are deleting before you delete it, and restore a
  mistake rather than recreating it — a restored task keeps its updates.

## Habits

- Ground every answer about the notes or boards in what the tools returned;
  never guess at content you have not read.
- Match the user's existing tags and labels rather than inventing near-duplicates
  (\`#meeting\` vs \`#meetings\`).
- Say briefly what you changed after a write. Do not paste raw tool JSON back.
`)

const copiedKey = ref<string | null>(null)

async function copy(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = id
    setTimeout(() => {
      if (copiedKey.value === id) copiedKey.value = null
    }, 2000)
  } catch {
    toast.add({ title: 'Could not copy — select the text and copy it manually', icon: 'i-lucide-alert-triangle', color: 'error' })
  }
}
</script>

<template>
  <div class="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 lg:pb-0">
    <div class="sticky top-0 z-10 border-b border-default bg-default/95 backdrop-blur-sm shrink-0">
      <div class="px-4 pt-3 pb-3.5 flex items-center gap-3">
        <UButton
          to="/settings"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Back to settings"
        />
        <h1 class="font-semibold text-sm">
          Connect an AI agent
        </h1>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <UContainer class="py-6 space-y-4">
        <!-- What this is -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-4 flex items-start gap-4">
            <div class="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <UIcon
                name="i-lucide-plug-zap"
                class="size-4.5 text-primary"
              />
            </div>
            <div class="min-w-0 space-y-2">
              <p class="text-sm font-medium">
                Arnotes speaks MCP
              </p>
              <p class="text-sm text-muted">
                The Model Context Protocol is how AI agents plug into apps. Arnotes ships an MCP server, so
                Claude Code, Claude Desktop and any other MCP client can search your notes, read them, and
                write new ones — working with your notes the way you would.
              </p>
              <p class="text-sm text-muted">
                Everything runs against your own install. No note ever leaves this server except to the agent
                you connect yourself.
              </p>
            </div>
          </div>
        </div>

        <!-- Step 1 -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
            <span class="size-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">1</span>
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">Create an API key</span>
          </div>
          <div class="px-5 py-4 space-y-3">
            <p class="text-sm text-muted">
              Keys live in Settings and belong to one workspace — a key made in a team reaches that team's
              notes, a key made in your personal workspace reaches only your own. Give it
              <span class="font-medium text-default">Read</span> to let an agent search and read, and
              <span class="font-medium text-default">Write</span> to let it create and edit.
            </p>
            <UButton
              to="/settings"
              label="Create a key in Settings"
              icon="i-lucide-key-round"
              color="primary"
              size="sm"
            />
          </div>
        </div>

        <!-- Step 2 -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
            <span class="size-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">2</span>
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">Point your agent at it</span>
          </div>

          <div class="divide-y divide-default">
            <div class="px-5 py-4 space-y-2">
              <p class="text-sm font-medium">
                Your endpoint
              </p>
              <div class="flex gap-2">
                <code class="flex-1 min-w-0 text-xs font-mono bg-elevated/50 border border-default rounded-md px-3 py-2 overflow-x-auto whitespace-nowrap">{{ endpoint }}</code>
                <UButton
                  :icon="copiedKey === 'endpoint' ? 'i-lucide-check' : 'i-lucide-copy'"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  aria-label="Copy endpoint"
                  @click="copy(endpoint, 'endpoint')"
                />
              </div>
              <p class="text-xs text-muted">
                Transport is streamable HTTP. Authenticate with the header
                <code class="font-mono">Authorization: Bearer &lt;your key&gt;</code>.
              </p>
            </div>

            <div class="px-5 py-4 space-y-2">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-terminal"
                  class="size-4 text-muted"
                />
                <p class="text-sm font-medium">
                  Claude Code
                </p>
                <UButton
                  :icon="copiedKey === 'cli' ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copiedKey === 'cli' ? 'Copied' : 'Copy'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="ml-auto"
                  @click="copy(claudeCodeCommand, 'cli')"
                />
              </div>
              <pre class="text-xs font-mono bg-elevated/50 border border-default rounded-md p-3 overflow-x-auto">{{ claudeCodeCommand }}</pre>
              <p class="text-xs text-muted">
                Then run <code class="font-mono">/mcp</code> inside Claude Code to confirm it connected.
              </p>
            </div>

            <div class="px-5 py-4 space-y-2">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-braces"
                  class="size-4 text-muted"
                />
                <p class="text-sm font-medium">
                  Claude Desktop and other MCP clients
                </p>
                <UButton
                  :icon="copiedKey === 'json' ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copiedKey === 'json' ? 'Copied' : 'Copy'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="ml-auto"
                  @click="copy(jsonConfig, 'json')"
                />
              </div>
              <pre class="text-xs font-mono bg-elevated/50 border border-default rounded-md p-3 overflow-x-auto">{{ jsonConfig }}</pre>
            </div>

            <div class="px-5 py-4 space-y-2">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-stethoscope"
                  class="size-4 text-muted"
                />
                <p class="text-sm font-medium">
                  Check it from a terminal
                </p>
                <UButton
                  :icon="copiedKey === 'curl' ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copiedKey === 'curl' ? 'Copied' : 'Copy'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="ml-auto"
                  @click="copy(curlCheck, 'curl')"
                />
              </div>
              <pre class="text-xs font-mono bg-elevated/50 border border-default rounded-md p-3 overflow-x-auto">{{ curlCheck }}</pre>
              <p class="text-xs text-muted">
                A list of tools means the key works. A <code class="font-mono">401</code> means it does not.
              </p>
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
            <span class="size-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">3</span>
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">What the agent can do</span>
          </div>
          <div class="px-5 py-4 space-y-3">
            <p class="text-sm text-muted">
              A key only exposes the tools its permissions cover — a read-only key never even sees the
              writing tools.
            </p>
            <div class="divide-y divide-default border border-default rounded-lg">
              <div
                v-for="tool in tools"
                :key="tool.name"
                class="px-3 py-2.5 flex items-start gap-3"
              >
                <UBadge
                  :label="scopeLabel(tool.scope)"
                  :color="tool.scope.endsWith(':write') ? 'warning' : 'neutral'"
                  variant="subtle"
                  size="sm"
                  class="mt-0.5 w-24 shrink-0 justify-center"
                />
                <div class="min-w-0">
                  <code class="text-xs font-mono font-medium">{{ tool.name }}</code>
                  <p class="text-xs text-muted mt-0.5">
                    {{ tool.description }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Skill -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
            <UIcon
              name="i-lucide-sparkles"
              class="size-4 text-primary"
            />
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">Optional: teach your agent the habits</span>
            <UButton
              :icon="copiedKey === 'skill' ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copiedKey === 'skill' ? 'Copied' : 'Copy skill'"
              color="neutral"
              variant="ghost"
              size="xs"
              class="ml-auto"
              @click="copy(skill, 'skill')"
            />
          </div>
          <div class="px-5 py-4 space-y-3">
            <p class="text-sm text-muted">
              The tools work on their own, but agents use them better with a little guidance. Save this as
              <code class="font-mono">.claude/skills/arnotes/SKILL.md</code> in a project, or
              <code class="font-mono">~/.claude/skills/arnotes/SKILL.md</code> to have it everywhere.
            </p>
            <pre class="text-xs font-mono bg-elevated/50 border border-default rounded-md p-3 overflow-x-auto max-h-96">{{ skill }}</pre>
          </div>
        </div>

        <!-- Keeping keys safe -->
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center gap-2">
            <UIcon
              name="i-lucide-shield"
              class="size-4 text-muted"
            />
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">Keeping keys safe</span>
          </div>
          <div class="px-5 py-4">
            <ul class="text-sm text-muted space-y-1.5 list-disc pl-4">
              <li>A key is shown once, when you create it. Arnotes stores only a hash and cannot show it again.</li>
              <li>Anyone holding a key has the access it was issued with — treat it like a password.</li>
              <li>Give agents read-only keys unless they genuinely need to write.</li>
              <li>Give each agent its own key, so revoking one does not disconnect the rest.</li>
              <li>Revoke a key in Settings the moment you stop using it; it stops working immediately.</li>
              <li>Set an expiry on keys you only need for a while.</li>
            </ul>
          </div>
        </div>
      </UContainer>
    </div>
  </div>

  <div
    class="fixed bottom-0 left-0 right-0 z-20 lg:hidden flex items-center justify-around px-8 border-t border-default bg-default/95 backdrop-blur-sm"
    style="padding-top: 0.5rem; padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
  >
    <UButton
      icon="i-lucide-panel-left"
      color="neutral"
      variant="ghost"
      size="md"
      aria-label="Open sidebar"
      @click="sidebarOpen = true"
    />
    <UButton
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
      size="md"
      aria-label="Back to settings"
      @click="navigateTo('/settings')"
    />
  </div>
</template>
