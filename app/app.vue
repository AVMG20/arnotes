<script setup>
useHead({
  htmlAttrs: { lang: 'en' },
  link: [{ rel: 'icon', href: '/favicon.ico' }]
})
useSeoMeta({ title: 'Notes' })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
