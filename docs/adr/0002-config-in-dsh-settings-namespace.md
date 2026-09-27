# Config in the DSH settings namespace, not .mcp.json files

Server Config is stored in the Adapter's `mcp` namespace of the DSH settings service (persisted to `$DSH_HOME/settings.yaml`, hot-reloaded, revision-fenced), not in pi-mcp-adapter's layered `.mcp.json` files. We still adopt the standard `mcpServers`-shaped JSON as the Config schema, so users can paste configs from pi, Claude Desktop, Cursor, or VS Code.

Considered options: pi's multi-file merge chain (`~/.config/mcp/mcp.json` → agent dirs → workspace `.mcp.json`, plus cross-tool `imports`) was rejected because DSH users interact through the web UI, not dotfiles; a single global namespace with a Settings > MCP form matches how every other DSH settings surface works, and gives us validation, conflict detection, and live update events for free.

Consequences: per-workspace servers and config-file imports become a later feature layered on top of the namespace (a workspace source merged at resolve time), not a change to where the global Config lives. The settings page needs an explicit JSON import action, since there is no file to copy-paste into.

*Amended (0.1.7):* DSH 0.1.7 replaced the settings service's registered namespaces with profile Loader-entry Config, so global Server Config now persists in the active profile composition under the `mcp-adapter` entry rather than an `mcp:` section of `settings.yaml`. The decisions that outlive the seam — standard `mcpServers`-shaped JSON, one global list edited through Settings > MCP, workspace sources layered at resolve time — all hold; see [ADR 0010](./0010-loader-entry-config-model.md).
