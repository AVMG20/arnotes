<script setup>
useHead({
  htmlAttrs: { lang: 'en' },
  titleTemplate: (title) => title ? `${title} — Arnotes` : 'Arnotes',
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' }
  ]
})
useSeoMeta({
  ogSiteName: 'Arnotes',
  twitterCard: 'summary',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
