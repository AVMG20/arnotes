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
    // App stacking order (see also TaskDrawer and AiChatWidget):
    //   40 drawer backdrop · 50 task drawer · 60 AI chat · 70 floating content
    // Reka portals render with position:fixed and z-index:auto, so without an
    // explicit z-index the drawer covers their menus and swallows clicks.
    dropdownMenu: {
      slots: {
        content: 'z-70'
      }
    },
    popover: {
      slots: {
        content: 'z-70'
      }
    },
    tooltip: {
      slots: {
        content: 'z-70'
      }
    },
    contextMenu: {
      slots: {
        content: 'z-70'
      }
    },
    commandPalette: {
      slots: {
        content: 'z-70'
      }
    },
    modal: {
      slots: {
        overlay: 'z-70',
        content: 'z-70'
      }
    }
  }
})
