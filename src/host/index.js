import { installMcpCommands } from './commands.js'
import { installMcpManager, installMcpManagerRpc } from './manager.js'
import { createMcpConnection } from './mcp-connection.js'
import { installMcpOauthCommands } from './oauth-commands.js'
import { createFileTokenStore } from './oauth.js'
import { installMcpOauth } from './oauth-service.js'
import { importLegacyMcpSettings } from './legacy-import.js'
import { installMcpPromptCommand } from './prompt-commands.js'
import { installMcpPromotions } from './promotions.js'
import { installMcpProxyTool } from './proxy-tool.js'
import { createMcpConfigScope, McpConfigSchema } from './settings.js'
import { installMcpSkill } from './skill.js'
import { installWorkspaceLayer } from './workspace-config.js'

export const name = 'dsh-mcp-adapter'

// 0.1.7 model: the Adapter's configuration is its Loader-entry Config (the
// `Config` schema below), always readable from `ctx.config`; Timer is only
// needed by the connection manager, and Settings by writes and the page.
export const inject = []

export const Config = McpConfigSchema

export function apply(ctx) {
  // The bundled agent skill is independent of every other Adapter feature: a
  // deployment without the skills service simply gets no skill entry.
  // `skillInstall` is read once here, from the entry Config.
  const scope = createMcpConfigScope(ctx)
  ctx.effect(() => () => scope.dispose(), 'dsh-mcp-adapter: config scope')
  const skillInstall = scope.get().skillInstall
  const layeredScope = installWorkspaceLayer(ctx, scope)

  // The Adapter owns a hand-built Settings page, so the shell must not also
  // auto-generate a form page for this entry. While the settings service is
  // mounted, also finish the one-time legacy import after the Loader settles:
  // the platform renames settings.yaml and imports same-named sections only,
  // so the `mcp` section under our `mcp-adapter` entry id is left behind.
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
  }, 'dsh-mcp-adapter: fiber disposal flag')
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'dsh-mcp-adapter: settings presentation',
    )
    void ctx.root.loader
      .await()
      .then(() => (disposed ? undefined : importLegacyMcpSettings(settingsCtx)))
      .catch((error) => settingsCtx.logger?.warn?.(error))
  })

  ctx.inject(['timer'], (managerCtx) => {
    const store = createFileTokenStore()
    let oauth
    const manager = installMcpManager(managerCtx, layeredScope, {
      connectionFactory: (serverName, config, callbacks, signal, sdk) =>
        createMcpConnection(serverName, config, callbacks, signal, sdk, {
          store,
          onAuthorizationRequired: (url) =>
            oauth?.noteAuthorizationRequired(serverName, url),
        }),
    })
    // The OAuth controller and every command read the LAYERED scope, so a
    // workspace-defined Server is signable and status-visible. Writes still
    // land in the entry Config: the layered scope forwards them there.
    oauth = installMcpOauth(managerCtx, manager, layeredScope, { store })
    managerCtx.inject(['connection'], (rpcCtx) => {
      installMcpManagerRpc(rpcCtx, manager, {
        // Refresh the workspace layer before each snapshot, giving the
        // Settings page poll a real refresh path for a file created after
        // startup.
        layerSnapshot: async () => {
          await layeredScope.refreshLayers()
          return layeredScope.layerSnapshot()
        },
        oauth,
      })
    })
    installMcpCommands(managerCtx, manager, layeredScope)
    installMcpOauthCommands(managerCtx, layeredScope, oauth)
    installMcpPromptCommand(managerCtx, manager)
    managerCtx.inject(['tools'], (toolCtx) => {
      installMcpProxyTool(toolCtx, manager)
      installMcpPromotions(toolCtx, manager, layeredScope)
    })
  })
  ctx.inject(['skills'], (skillCtx) => installMcpSkill(skillCtx, { skillInstall }))
}

export * from './commands.js'
export * from './legacy-import.js'
export * from './manager.js'
export * from './mcp-connection.js'
export * from './oauth-commands.js'
export * from './oauth-service.js'
export * from './oauth.js'
export * from './output-guard.js'
export * from './prompt-commands.js'
export * from './promotions.js'
export * from './proxy-tool.js'
export * from './settings.js'
export * from './skill.js'
export * from './workspace-config.js'
