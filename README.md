# dsh-mcp-adapter

A [Deepseek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that connects the DSH agent to MCP servers. It mirrors the major features of [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter): one token-efficient `mcp` proxy tool over every configured server, optional per-tool promotion to native DSH tools, and lazy server lifecycles. Servers are added and configured in the DSH web UI under **Settings > MCP**; configuration persists in the DSH settings document (`$DSH_HOME/settings.yaml`, namespace `mcp`).

Vocabulary lives in [CONTEXT.md](./CONTEXT.md). Design decisions live in [docs/adr/](./docs/adr/). Work is tracked as [GitHub issues](https://github.com/auggie246/dsh-mcp-adapter/issues).

## Status

The v1 implementation is complete through issues #1–#7. See the [v1 end-to-end verification](./docs/verification/v1-e2e.md). Issues #8–#14 track deferred follow-ups.

## Config

The Host registers one live DSH settings namespace, `mcp`. Its user layer lives under `mcp:` in `$DSH_HOME/settings.yaml`; the Settings > MCP page owns normal edits.

```yaml
mcp:
  mcpServers:
    filesystem:
      command: npx
      args: [-y, "@modelcontextprotocol/server-filesystem", /workspace]
      autoAllow: false
    hosted:
      url: https://mcp.example.com/api
      headers:
        Authorization: Bearer example-token
```

Each Server configures exactly one Transport: `command` for stdio, or `url` for streamable HTTP with SSE fallback. Adapter extension fields are `disabled`, `autoAllow`, `lifecycle` (`lazy` only in v1), `idleTimeoutMinutes` (default `10`), and `promotedTools`.

The schema rejects unknown fields and invalid transport combinations before they reach `$DSH_HOME/settings.yaml`. Each `env` and `headers` value has the DSH `secret` schema role. Wire views retain each key and redact its value.

## Settings page

Open **Settings > MCP** to add, import, edit, reconnect, disable, or delete a Server. The Server list shows live connection state and cached tool counts. The detail panel manages Transport fields, secret values, Auto-allow, the idle timeout, and Promotions.

JSON import accepts the standard `{ "mcpServers": { ... } }` shape. Import replaces matching Server entries and preserves Servers absent from the import.

Every page write carries the latest namespace revision. Field edits use path mutations. Existing secret values remain saved when their value inputs stay blank.

## Server lifecycle

The Host creates no unpromoted Server connection at startup. The first tool-list or tool-call request connects the Server and fills an in-memory metadata cache. A persisted Promotion can connect once to rebuild its native input schema. MCP `tools/list_changed` notifications refresh the cache. The default idle timeout closes the connection after 10 minutes without a request; the next request reconnects it.

Changing, disabling, or removing a Server closes its connection and clears its cache. Re-enabling a Server restores the lazy behavior. A Connection RPC channel, `/mcp-adapter`, exposes detached `status`, `catalog`, and combined `overview` snapshots. Its `reconnect` endpoint restarts one named Server. These endpoints never expose Config secrets or SDK objects.

## Proxy Tool

The Host registers one global `mcp` tool with three actions:

```text
mcp({ action: "search", query: "screenshot" })
mcp({ action: "describe", server: "browser", tool: "take_screenshot" })
mcp({ action: "call", server: "browser", tool: "take_screenshot", args: {} })
```

Search results use `<server>__<tool>` names to avoid collisions. The first search fills empty metadata caches; later search and describe operations use the cache. Call requests ask for DSH approval unless that Server has `autoAllow: true`.

Call, search, and describe output is limited to 50 KiB and 2,000 lines. Larger text uses `spillStore` for a full-result reference. Raw structured details larger than 16 KiB become a compact summary with their own spill reference.

## Promotion

Add a raw MCP tool name to a Server's `promotedTools` list to register `<server>__<tool>` as a native DSH tool. The native tool uses the MCP input schema and the same approval, call, and output-guard path as `mcp({ action: "call" })`.

Promotion changes apply through `settings/updated`. They do not restart a connected Server. Removing a Promotion unregisters its native tool. Non-promoted tools remain available only through the `mcp` Proxy Tool.

DSH native tool names must match `[A-Za-z0-9_-]` and contain at most 64 characters. The Adapter logs a warning and skips an invalid or colliding Promotion name.

## Install (local, development)

Requires the `dsh` CLI and a web profile (the browser GUI you run DSH with).

```sh
pnpm install
pnpm build          # produces lib/client.js (required before install)
dsh plugin --profile web add /absolute/path/to/dsh-mcp-adapter
```

Then restart DSH. The Settings panel (`⌘,` / sidebar foot) gains an **MCP** section.

During client development, run `pnpm dev` alongside DSH: the always-mounted `dsh-client-hmr` row picks up every bundle rewrite and reloads the page plugin without a restart.

Host-half changes need a DSH restart (the web profile disables host HMR for plugin rows).

## Uninstall

```sh
dsh plugin --profile web remove dsh-mcp-adapter
```

## Layout

```
cordis.patch.yml   bundle patch: inserts the host composition row on install
src/host/          host half: plain ESM, no build step
src/client/        client half: JSX, bundled to lib/client.js
build.mjs          esbuild wrapper producing the loader-compatible bundle
lib/client.js      build artifact (gitignored), required at runtime
docs/adr/          architecture decisions
CONTEXT.md         project vocabulary
```
