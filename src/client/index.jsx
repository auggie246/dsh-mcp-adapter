// Client half of dsh-mcp-adapter.
//
// Scaffold state (#1): registers the Settings > MCP section with a placeholder
// page so the install is visible end to end. The real form arrives in #6,
// bound to the Host `mcp` settings namespace via ctx.settingsScope.

export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'mcp',
        order: 30,
        label: 'MCP',
      },
      () => (
        <div style={{ padding: 16 }}>
          <h2>MCP</h2>
          <p>
            dsh-mcp-adapter is installed. The server list, per-server detail
            form, and JSON import land with issue #6.
          </p>
        </div>
      ),
    ),
  )
}
