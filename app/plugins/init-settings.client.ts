import { loadUserSettings } from '~/composables/useUserSettings'

export default defineNuxtPlugin(async () => {
  await loadUserSettings()
})
