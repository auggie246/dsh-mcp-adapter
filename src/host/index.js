import { installMcpCommands } from './commands.js'
import { installMcpManager, installMcpManagerRpc } from './manager.js'
import { installMcpPromptCommand } from './prompt-commands.js'
import { installMcpPromotions } from './promotions.js'
import { installMcpProxyTool } from './proxy-tool.js'
import { installMcpSettings } from './settings.js'

export const name = 'dsh-mcp-adapter'

// Settings and Timer are optional at the Adapter row. The manager starts only
// while both Services exist, but the Config namespace can exist without Timer.
export const inject = []

export function apply(ctx) {
  installMcpSettings(ctx, (settingsCtx, scope) => {
    settingsCtx.inject(['timer'], (managerCtx) => {
      const manager = installMcpManager(managerCtx, scope)
      managerCtx.inject(['connection'], (rpcCtx) => {
        installMcpManagerRpc(rpcCtx, manager)
      })
      managerCtx.inject(['commands'], (cmdCtx) => {
        installMcpCommands(cmdCtx, manager, scope)
      })
      managerCtx.inject(['tools'], (toolCtx) => {
        installMcpProxyTool(toolCtx, manager)
        installMcpPromotions(toolCtx, manager, scope)
      })
      managerCtx.inject(['commands'], (commandCtx) => {
        installMcpPromptCommand(commandCtx, manager)
      })
    })
  })
}

export * from './commands.js'
export * from './manager.js'
export * from './mcp-connection.js'
export * from './output-guard.js'
export * from './prompt-commands.js'
export * from './promotions.js'
export * from './proxy-tool.js'
export * from './settings.js'
