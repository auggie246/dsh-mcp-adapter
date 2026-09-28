import { McpSettingsPage } from './McpSettingsPage.jsx'
import {
  MCP_RPC_CHANNEL,
  MCP_RPC_ENDPOINT_PREFIX,
  MCP_SETTINGS_NAMESPACE,
  McpSettingsController,
} from './settings-controller.js'
import { createSettingsApi } from './settings-api.js'
import { installMcpSettingsStyles } from './styles.js'

// `remote` carries the settings write face (see settings-api.js); it exists on
// every supported harness, while the mounted dotted `remote.settings`
// namespace deliberately stays UNDECLARED — declaring it would park the
// plugin on a profile that never mounts the remotes bundle. `configForms` is
// the settings-domain base service: `get(entryId)` owns the per-entry read
// mirror and write queue, `describe()` the shared document mirror.
export const inject = ['slots', 'configForms', 'connection', 'remote']

export function apply(ctx) {
  const scope = ctx.configForms.get(MCP_SETTINGS_NAMESPACE)
  const describe = ctx.configForms.describe()
  const controller = new McpSettingsController({
    scope,
    describe,
    settingsApi: createSettingsApi(ctx),
    rpc: (endpoint, payload, signal) =>
      ctx.connection.rpc.call(
        MCP_RPC_CHANNEL,
        `${MCP_RPC_ENDPOINT_PREFIX}${endpoint}`,
        payload,
        signal,
      ),
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
