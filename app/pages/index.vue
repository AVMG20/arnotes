<script setup lang="ts">
definePageMeta({ middleware: [] })

useSeoMeta({
  title: 'Notes that organize themselves',
  description: 'Write and tag. No folders, no hierarchy — find any note in seconds with #tags. Arnotes is a fast, tag-based note-taking app.',
  ogTitle: 'Arnotes — Notes that organize themselves',
  ogDescription: 'Write and tag. No folders, no hierarchy — find any note in seconds with #tags.',
  ogImage: '/screenshot.png',
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-white flex flex-col">
    <!-- Nav -->
    <header class="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto w-full">
      <AppLogo class="text-xl" />
      <UButton
        to="/note"
        color="neutral"
        variant="ghost"
        size="sm"
      >
        Sign in
      </UButton>
    </header>

    <!-- Hero -->
    <main class="flex-1 flex flex-col items-center text-center px-6 pt-16 pb-10 max-w-3xl mx-auto w-full">
      <h1 class="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
        Notes that organize<br>
        <span class="text-emerald-400">themselves.</span>
      </h1>

      <p class="text-zinc-400 text-lg max-w-md mb-8">
        Just write and tag. No folders, no hierarchy — find any note in seconds with <span class="text-zinc-200">#tags</span>.
      </p>

      <UButton
        to="/note"
        color="primary"
        size="xl"
        class="rounded-full px-8"
        trailing-icon="i-lucide-arrow-right"
      >
        Start writing
      </UButton>
    </main>

    <!-- Screenshot frame -->
    <div class="px-6 pb-16 max-w-5xl mx-auto w-full">
      <div class="rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl shadow-black/60 bg-zinc-900">
        <div class="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <span class="w-3 h-3 rounded-full bg-zinc-700" />
          <span class="w-3 h-3 rounded-full bg-zinc-700" />
          <span class="w-3 h-3 rounded-full bg-zinc-700" />
        </div>
        <img
          src="/screenshot.png"
          alt="Arnotes app screenshot"
          class="w-full block"
        />
      </div>
    </div>

    <!-- Features -->
    <section class="pb-20 px-6 max-w-5xl mx-auto w-full">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="feature in [
            { icon: 'i-lucide-hash', title: 'Tag-based', desc: 'Write #tags inline. Notes self-organize as you type — no folders needed.' },
            { icon: 'i-lucide-pen-line', title: 'Rich editor', desc: 'Headings, code blocks, task lists, and file attachments out of the box.' },
            { icon: 'i-lucide-palette', title: 'Themeable', desc: 'Choose your accent color and toggle between light and dark mode.' },
            { icon: 'i-lucide-file-code', title: 'Markdown', desc: 'Export any note as Markdown. Paste Markdown directly into the editor and it just works.' },
          ]"
          :key="feature.title"
          class="flex flex-col gap-2 p-5 rounded-2xl border border-zinc-800 bg-zinc-900/40"
        >
          <div class="flex items-center gap-2">
            <UIcon :name="feature.icon" class="size-5 text-emerald-400 shrink-0" />
            <p class="font-semibold text-sm text-white">{{ feature.title }}</p>
          </div>
          <p class="text-sm text-zinc-500 leading-relaxed">{{ feature.desc }}</p>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-zinc-900 py-6 text-center text-xs text-zinc-600">
      <AppLogo class="text-sm mx-auto mb-2 opacity-40" />
    </footer>
  </div>
</template>
