export const PRIMARY_COLORS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'
] as const

export const NEUTRAL_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const

export const POPULAR_OPENROUTER_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-4.1-mini',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-flash-1.5',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-large',
  'deepseek/deepseek-chat'
] as const

export type PrimaryColor = typeof PRIMARY_COLORS[number]
export type NeutralColor = typeof NEUTRAL_COLORS[number]

interface AppSettings {
  primaryColor: PrimaryColor
  neutralColor: NeutralColor
  openrouterApiKey: string | null
  openrouterApiKeyMasked: string | null
  openrouterModel: string
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

const _primaryColor = ref<PrimaryColor>('emerald')
const _neutralColor = ref<NeutralColor>('zinc')
const _openrouterApiKey = ref<string | null>(null)
const _openrouterApiKeyMasked = ref<string | null>(null)
const _openrouterModel = ref<string>(DEFAULT_MODEL)

export async function loadUserSettings() {
  try {
    const data = await $fetch<AppSettings>('/api/settings')
    _primaryColor.value = data.primaryColor
    _neutralColor.value = data.neutralColor
    _openrouterApiKey.value = data.openrouterApiKey
    _openrouterApiKeyMasked.value = data.openrouterApiKeyMasked
    _openrouterModel.value = data.openrouterModel || DEFAULT_MODEL
    applyColors(data.primaryColor, data.neutralColor)
  } catch {
    // Not authenticated yet — silently skip
  }
}

function applyColors(primary: string, neutral: string) {
  const appConfig = useAppConfig() as { ui: { colors: { primary: string, neutral: string } } }
  appConfig.ui.colors.primary = primary
  appConfig.ui.colors.neutral = neutral
}

export function useUserSettings() {
  const appConfig = useAppConfig() as { ui: { colors: { primary: string, neutral: string } } }

  async function setPrimaryColor(color: PrimaryColor) {
    _primaryColor.value = color
    appConfig.ui.colors.primary = color
    await $fetch('/api/settings', { method: 'PUT', body: { primaryColor: color, neutralColor: _neutralColor.value } })
  }

  async function setNeutralColor(color: NeutralColor) {
    _neutralColor.value = color
    appConfig.ui.colors.neutral = color
    await $fetch('/api/settings', { method: 'PUT', body: { primaryColor: _primaryColor.value, neutralColor: color } })
  }

  async function setOpenRouterApiKey(key: string) {
    const trimmed = key.trim()
    if (!trimmed) {
      // clear
      await $fetch('/api/settings', {
        method: 'PUT',
        body: { primaryColor: _primaryColor.value, neutralColor: _neutralColor.value, openrouterApiKey: '' }
      })
      _openrouterApiKey.value = null
      _openrouterApiKeyMasked.value = null
      return
    }
    await $fetch('/api/settings', {
      method: 'PUT',
      body: { primaryColor: _primaryColor.value, neutralColor: _neutralColor.value, openrouterApiKey: trimmed }
    })
    _openrouterApiKey.value = trimmed
    _openrouterApiKeyMasked.value = trimmed.slice(0, 4) + '••••' + trimmed.slice(-4)
  }

  async function setOpenRouterModel(model: string) {
    const trimmed = model.trim() || DEFAULT_MODEL
    _openrouterModel.value = trimmed
    await $fetch('/api/settings', {
      method: 'PUT',
      body: { primaryColor: _primaryColor.value, neutralColor: _neutralColor.value, openrouterModel: trimmed }
    })
  }

  return {
    primaryColor: _primaryColor,
    neutralColor: _neutralColor,
    openrouterApiKey: _openrouterApiKey,
    openrouterApiKeyMasked: _openrouterApiKeyMasked,
    openrouterModel: _openrouterModel,
    PRIMARY_COLORS,
    NEUTRAL_COLORS,
    POPULAR_OPENROUTER_MODELS,
    setPrimaryColor,
    setNeutralColor,
    setOpenRouterApiKey,
    setOpenRouterModel
  }
}
