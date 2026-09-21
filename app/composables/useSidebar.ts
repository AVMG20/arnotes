const _sidebarOpen = ref(false)
export type AppMode = 'notes' | 'projects'

const _appMode = useCookie<AppMode>('app-mode', { default: () => 'notes' })

export function useSidebar() {
  return {
    sidebarOpen: _sidebarOpen,
    appMode: _appMode
  }
}
