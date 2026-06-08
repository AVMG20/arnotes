export const PRIMARY_COLORS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const

export const NEUTRAL_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const

export type PrimaryColor = typeof PRIMARY_COLORS[number]
export type NeutralColor = typeof NEUTRAL_COLORS[number]

interface AppSettings {
  primaryColor: PrimaryColor
  neutralColor: NeutralColor
}

const _primaryColor = ref<PrimaryColor>('emerald')
const _neutralColor = ref<NeutralColor>('zinc')

export async function loadUserSettings() {
  try {
    const data = await $fetch<AppSettings>('/api/settings')
    _primaryColor.value = data.primaryColor
    _neutralColor.value = data.neutralColor
    applyColors(data.primaryColor, data.neutralColor)
  } catch {
    // Not authenticated yet — silently skip
  }
}

function applyColors(primary: string, neutral: string) {
  const appConfig = useAppConfig() as { ui: { colors: { primary: string; neutral: string } } }
  appConfig.ui.colors.primary = primary
  appConfig.ui.colors.neutral = neutral
}

export function useUserSettings() {
  const appConfig = useAppConfig() as { ui: { colors: { primary: string; neutral: string } } }

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

  return {
    primaryColor: _primaryColor,
    neutralColor: _neutralColor,
    PRIMARY_COLORS,
    NEUTRAL_COLORS,
    setPrimaryColor,
    setNeutralColor,
  }
}
