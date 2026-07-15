interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  architecture?: {
    modality?: string
  }
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[]
}

export default defineCachedEventHandler(async () => {
  const response = await $fetch<OpenRouterModelsResponse>('https://openrouter.ai/api/v1/models')
  const models = response.data
    .filter(model => model.id)
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length ?? null,
      modality: model.architecture?.modality ?? null
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { models }
}, {
  maxAge: 60 * 60,
  swr: true,
  name: 'openrouter-models',
  getKey: () => 'catalog'
})
