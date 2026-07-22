interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  architecture?: {
    modality?: string
  }
  pricing?: {
    prompt?: string
    completion?: string
  }
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[]
}

function parsePrice(price: string | undefined): number | null {
  if (price === undefined) return null
  const parsed = Number(price)
  return Number.isFinite(parsed) ? parsed : null
}

export default defineCachedEventHandler(async () => {
  const response = await $fetch<OpenRouterModelsResponse>('https://openrouter.ai/api/v1/models')
  const models = response.data
    .filter(model => model.id)
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length ?? null,
      modality: model.architecture?.modality ?? null,
      inputPrice: parsePrice(model.pricing?.prompt),
      outputPrice: parsePrice(model.pricing?.completion)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { models }
}, {
  maxAge: 60 * 60,
  swr: true,
  name: 'openrouter-models',
  getKey: event => getQuery(event).refresh === 'true' ? `catalog-${Date.now()}` : 'catalog'
})
