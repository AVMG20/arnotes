const _sidebarOpen = ref(false)

export function useSidebar() {
  return { sidebarOpen: _sidebarOpen }
}
