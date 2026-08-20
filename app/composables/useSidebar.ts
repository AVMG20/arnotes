const _sidebarOpen = ref(false)
const _appMode = useCookie<'notes' | 'projects'>('app-mode', { default: () => 'notes' })

export function useSidebar() {
  return {
    sidebarOpen: _sidebarOpen,
    appMode: _appMode
  }
}
