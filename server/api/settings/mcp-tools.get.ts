import { MCP_TOOLS } from '../../utils/mcpTools'

/**
 * The tool catalogue, for the MCP setup guide. Reading it from the same registry
 * the server answers `tools/list` from keeps the documentation honest.
 */
export default defineEventHandler(() => ({
  tools: MCP_TOOLS.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    scope: tool.scope
  }))
}))
