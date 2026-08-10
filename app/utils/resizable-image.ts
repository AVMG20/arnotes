import Image from '@tiptap/extension-image'
import type { NodeViewRenderer } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageView from '~/components/ImageView.vue'

function parseWidth(element: HTMLElement): number | null {
  const attribute = element.getAttribute('width')
  if (attribute) {
    const parsed = Number.parseInt(attribute, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const style = element.style.width
  if (style?.endsWith('px')) {
    const parsed = Number.parseInt(style, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  return null
}

/**
 * Replaces the default Nuxt UI image node so images can be resized (drag or
 * typed width) and aligned left/center/right. Pass `:image="false"` to
 * `UEditor` and register this extension instead.
 */
export const ResizableImage = Image.extend({
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => parseWidth(element as HTMLElement),
        renderHTML: (attributes) => {
          if (!attributes.width) return {}
          return { width: attributes.width, style: `width: ${attributes.width}px;` }
        }
      },
      align: {
        default: null,
        parseHTML: element => (element as HTMLElement).getAttribute('data-align'),
        renderHTML: (attributes) => {
          if (!attributes.align) return {}
          return { 'data-align': attributes.align }
        }
      }
    }
  },

  // Annotated explicitly: without it the node view's type refers back to this
  // extension and TypeScript gives up on inferring either (TS7022/TS7023).
  addNodeView(): NodeViewRenderer {
    return VueNodeViewRenderer(ImageView)
  }
})
