export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'zinc'
    },
    scrollArea: {
      slots: {
        root: 'scrollbar-hidden'
      }
    },
    // Reka portals render with position:fixed and z-index:auto, so any app-level
    // stacking context (the fixed task drawer at z-40) covers their menus and
    // swallows clicks. Pin all floating content above the drawer.
    dropdownMenu: {
      slots: {
        content: 'z-50'
      }
    },
    popover: {
      slots: {
        content: 'z-50'
      }
    },
    tooltip: {
      slots: {
        content: 'z-50'
      }
    },
    contextMenu: {
      slots: {
        content: 'z-50'
      }
    },
    commandPalette: {
      slots: {
        content: 'z-50'
      }
    }
  }
})
