import { installMcpSettings } from './settings.js'

export const name = 'dsh-mcp-adapter'

// Settings is optional at the Adapter row. ctx.inject below activates the
// settings-owned subtree when the Host settings provider is available and
// disposes it with that provider's fiber.
export const inject = []

export function apply(ctx) {
  installMcpSettings(ctx)
}

export * from './settings.js'
