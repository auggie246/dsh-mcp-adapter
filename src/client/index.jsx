import { McpSettingsPage } from './McpSettingsPage.jsx'
import {
  MCP_RPC_CHANNEL,
  MCP_SETTINGS_NAMESPACE,
  McpSettingsController,
} from './settings-controller.js'
import { installMcpSettingsStyles } from './styles.js'

export const inject = ['slots', 'settingsScope', 'connection']

export function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: MCP_SETTINGS_NAMESPACE })
  const describe = ctx.settingsScope.describe()
  const controller = new McpSettingsController({
    scope,
    describe,
    settingsApi: ctx.connection.api.settings,
    rpc: (endpoint, payload, signal) =>
      ctx.connection.rpc.call(MCP_RPC_CHANNEL, endpoint, payload, signal),
  })

  ctx.effect(() => installMcpSettingsStyles(), 'mcp-adapter: Settings styles')
  ctx.effect(() => () => controller.dispose(), 'mcp-adapter: Settings controller')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'mcp',
        order: 30,
        label: 'MCP',
        inject: () => ({ controller }),
      },
      McpSettingsPage,
    ),
  )
}
