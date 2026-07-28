// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      // Vue 3 supports fragments, which these pages use for fixed overlays.
      'vue/no-multiple-template-root': 'off'
    }
  }
)
