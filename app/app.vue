<script setup>
useHead({
  htmlAttrs: { lang: 'en' },
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon-180x180.png' }
  ]
})
useSeoMeta({ title: 'Notes' })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
