import { installMcpManager, installMcpManagerRpc } from './manager.js'
import { createMcpConnection } from './mcp-connection.js'
import { installMcpOauthCommands } from './oauth-commands.js'
import { createFileTokenStore } from './oauth.js'
import { installMcpOauth } from './oauth-service.js'
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
      const store = createFileTokenStore()
      let oauth
      const manager = installMcpManager(managerCtx, scope, {
        connectionFactory: (serverName, config, callbacks, signal, sdk) =>
          createMcpConnection(serverName, config, callbacks, signal, sdk, {
            store,
            onAuthorizationRequired: (url) =>
              oauth?.noteAuthorizationRequired(serverName, url),
          }),
      })
      oauth = installMcpOauth(managerCtx, manager, scope, { store })
      managerCtx.inject(['connection'], (rpcCtx) => {
        installMcpManagerRpc(rpcCtx, manager, { oauth })
      })
      installMcpOauthCommands(managerCtx, manager, scope, oauth)
      managerCtx.inject(['tools'], (toolCtx) => {
        installMcpProxyTool(toolCtx, manager)
        installMcpPromotions(toolCtx, manager, scope)
      })
    })
  })
}

export * from './manager.js'
export * from './mcp-connection.js'
export * from './oauth-commands.js'
export * from './oauth-service.js'
export * from './oauth.js'
export * from './output-guard.js'
export * from './promotions.js'
export * from './proxy-tool.js'
export * from './settings.js'
