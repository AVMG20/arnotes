export default defineNuxtPlugin(() => {
  if (!import.meta.dev || !('serviceWorker' in navigator)) return

  navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    const results = await Promise.all(registrations.map(registration => registration.unregister()))
    if (results.some(Boolean)) window.location.reload()
  })
})
