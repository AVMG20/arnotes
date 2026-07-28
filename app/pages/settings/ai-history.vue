<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({ layout: 'app' })
useSeoMeta({ title: 'AI History' })

interface AiHistoryPrompt {
  id: string
  action: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  createdAt: string
}

interface AiHistoryData {
  totals: {
    prompts: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
  }
  prompts: AiHistoryPrompt[]
}

const { sidebarOpen } = useSidebar()
const { data, status, error } = useFetch<AiHistoryData>('/api/settings/ai-history', { server: false })

function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)
}

function formatTokens(tokens: number): string {
  return new Intl.NumberFormat().format(tokens)
}

function formatAction(action: string): string {
  return action === 'custom' ? 'Custom instruction' : action.replaceAll('-', ' ')
}

function formatDate(value: string): string {
  return format(new Date(value), 'PP p')
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
          AI history
        </h1>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <UContainer class="py-6 space-y-4">
        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">All-time usage</span>
          </div>
          <div class="grid grid-cols-2 lg:grid-cols-4 divide-x divide-default">
            <div class="p-5">
              <p class="text-xl font-bold tabular-nums leading-none">
                {{ data?.totals.prompts ?? 0 }}
              </p>
              <p class="text-xs text-muted mt-1">
                Prompts
              </p>
            </div>
            <div class="p-5">
              <p class="text-xl font-bold tabular-nums leading-none">
                {{ formatTokens(data?.totals.totalTokens ?? 0) }}
              </p>
              <p class="text-xs text-muted mt-1">
                Total tokens
              </p>
            </div>
            <div class="p-5">
              <p class="text-xl font-bold tabular-nums leading-none">
                {{ formatTokens(data?.totals.inputTokens ?? 0) }}
              </p>
              <p class="text-xs text-muted mt-1">
                Input tokens
              </p>
            </div>
            <div class="p-5">
              <p class="text-xl font-bold tabular-nums leading-none">
                {{ formatMoney(data?.totals.cost ?? 0) }}
              </p>
              <p class="text-xs text-muted mt-1">
                Total cost
              </p>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-default bg-default overflow-hidden">
          <div class="px-5 py-3 border-b border-default bg-elevated/40 flex items-center justify-between gap-3">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">Latest prompts</span>
            <span class="text-xs text-muted">Last 50</span>
          </div>

          <div
            v-if="status === 'pending'"
            class="px-5 py-10 text-center text-sm text-muted"
          >
            Loading AI usage...
          </div>
          <div
            v-else-if="error"
            class="px-5 py-10 text-center text-sm text-error"
          >
            Could not load AI usage history.
          </div>
          <div
            v-else-if="!data?.prompts.length"
            class="px-5 py-10 text-center"
          >
            <UIcon
              name="i-lucide-history"
              class="size-6 text-muted mb-2"
            />
            <p class="text-sm font-medium">
              No AI prompts yet
            </p>
            <p class="text-xs text-muted mt-1">
              Usage appears here after an AI response finishes.
            </p>
          </div>
          <div
            v-else
            class="divide-y divide-default"
          >
            <div
              v-for="prompt in data.prompts"
              :key="prompt.id"
              class="px-5 py-4 flex items-center gap-4"
            >
              <div class="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon
                  name="i-lucide-sparkles"
                  class="size-4 text-primary"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium capitalize">
                  {{ formatAction(prompt.action) }}
                </p>
                <p class="text-xs text-muted truncate mt-0.5">
                  {{ prompt.model }} · {{ formatDate(prompt.createdAt) }}
                </p>
              </div>
              <div class="text-right shrink-0">
                <p class="text-sm font-medium tabular-nums">
                  {{ formatMoney(prompt.cost) }}
                </p>
                <p class="text-xs text-muted tabular-nums mt-0.5">
                  {{ formatTokens(prompt.totalTokens) }} tokens
                </p>
                <p class="text-xs text-muted tabular-nums">
                  {{ formatTokens(prompt.inputTokens) }} in / {{ formatTokens(prompt.outputTokens) }} out
                </p>
              </div>
            </div>
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
      to="/settings"
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
      size="md"
      aria-label="Back to settings"
    />
  </div>
</template>
