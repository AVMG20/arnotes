// The Streamable HTTP transport lets a server decline server-initiated streams.
// Arnotes is stateless and only ever answers a POST, so the SSE channel clients
// probe for is refused here rather than left hanging.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Allow', 'POST')
  throw createError({ statusCode: 405, message: 'This MCP endpoint only accepts POST requests' })
})
