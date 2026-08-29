# dsh-mcp-adapter

A [Deepseek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that connects the DSH agent to MCP servers. It mirrors the major features of [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter): one token-efficient `mcp` proxy tool over every configured server, optional per-tool promotion to native DSH tools, and lazy server lifecycles. Servers are added and configured in the DSH web UI under **Settings > MCP**; configuration persists in the DSH settings document (`$DSH_HOME/settings.yaml`, namespace `mcp`).

Vocabulary lives in [CONTEXT.md](./CONTEXT.md). Design decisions live in [docs/adr/](./docs/adr/). Work is tracked as [GitHub issues](https://github.com/auggie246/dsh-mcp-adapter/issues).

## Status

Early development. See issues #1–#7 for the v1 scope and #8–#13 for deferred follow-ups.

## Config

The Host registers one live DSH settings namespace, `mcp`. Its user layer lives under `mcp:` in `$DSH_HOME/settings.yaml`; the Settings > MCP page will own normal edits.

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

The schema rejects unknown fields and invalid transport combinations before they reach `$DSH_HOME/settings.yaml`. `env` and `headers` have the DSH `secret` schema role, so wire settings views redact their values.

## Server lifecycle

The Host creates no Server connection at startup. The first tool-list or tool-call request connects the Server and fills an in-memory metadata cache. MCP `tools/list_changed` notifications refresh that cache. The default idle timeout closes the connection after 10 minutes without a request; the next request reconnects it.

Changing, disabling, or removing a Server closes its connection and clears its cache. Re-enabling a Server restores the lazy behavior. A Connection RPC channel, `/mcp-adapter`, exposes detached `status` and `catalog` snapshots for the Settings page without exposing Config secrets or SDK objects.

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
