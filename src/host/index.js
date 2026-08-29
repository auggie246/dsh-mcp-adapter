// Host half of dsh-mcp-adapter.
//
// Scaffold state (#1): a valid no-op so the composition row mounts cleanly.
// Real capabilities land in later issues:
//   #2  settings namespace `mcp` + mcpServers-compatible schema
//   #3  MCP client manager (lazy lifecycle, stdio + HTTP/SSE)
//   #4  Proxy Tool `mcp` (search/describe/call) with approval gating
//   #5  per-tool Promotion to native DSH tools

export const name = 'dsh-mcp-adapter'

export const inject = []

export function apply(ctx) {
  ctx.on('dispose', () => {})
}
