// Clients send DELETE to end an MCP session. There is no session state to drop,
// so the request simply succeeds.
export default defineEventHandler((event) => {
  setResponseStatus(event, 204)
  return null
})
