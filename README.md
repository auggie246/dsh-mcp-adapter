# dsh-mcp-adapter

A [Deepseek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that connects the DSH agent to MCP servers. It mirrors the major features of [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter): one token-efficient `mcp` proxy tool over every configured server, optional per-tool promotion to native DSH tools, and configurable Server lifecycles (`lazy` by default). Servers are added and configured in the DSH web UI under **Settings > MCP**; configuration persists in the DSH settings document (`$DSH_HOME/settings.yaml`, namespace `mcp`).

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
    github:
      url: https://mcp.example.com/other
      auth: oauth
      scopes: [repo, read:org]
```

Each Server configures exactly one Transport: `command` for stdio, or `url` for streamable HTTP with SSE fallback. Adapter extension fields are `auth` (`headers` by default, or `oauth` for HTTP Servers), `scopes` (OAuth scopes, requires `auth: oauth`), `disabled`, `autoAllow`, `lifecycle` (`lazy`, `eager`, `keep-alive`, or `lazy-keep-alive`; default `lazy`), `idleTimeoutMinutes` (default `10`), and `promotedTools`.

The schema rejects unknown fields and invalid transport combinations before they reach `$DSH_HOME/settings.yaml`. Each `env` and `headers` value has the DSH `secret` schema role. Wire views retain each key and redact its value.

### Workspace Config layer

The Host also reads `.dsh/mcp.json` under its workspace root and merges it over the global namespace at resolve time. A workspace Server entry with the same name replaces the global entry wholesale; workspace-only names are added; global-only names pass through. Disable or override a Server from the workspace by defining it there with `disabled: true`.

The workspace file uses the same `mcpServers` shape and validation as the global Config. Unknown top-level keys (only `mcpServers` is allowed) or an invalid Server entry reject the whole layer, which fails closed to the global-only Config with a Host warning; a missing file is an empty layer. Values are never environment-variable-interpolated. The Adapter never writes the workspace file: page edits, imports, and API writes all stay on the global namespace, which the workspace file overrides. See [ADR-0005](./docs/adr/0005-per-workspace-config.md).

## Settings page

Open **Settings > MCP** to add, import, edit, reconnect, disable, or delete a Server. The Server list shows live connection state and cached tool counts. The detail panel manages Transport fields, secret values, Auto-allow, the idle timeout, and Promotions. HTTP Servers pick their HTTP authentication mode (static headers or OAuth 2.0 with PKCE) and, for OAuth, enter the scopes to request.

Servers whose Config comes from the workspace `.dsh/mcp.json` show a `workspace` badge in the Server list. Their detail panel explains that the workspace file defines or overrides the Server and disables the save control: edits there write the global layer, which the workspace file overrides.

JSON import accepts the standard `{ "mcpServers": { ... } }` shape. Import replaces matching Server entries and preserves Servers absent from the import.

Every page write carries the latest namespace revision. Field edits use path mutations. Existing secret values remain saved when their value inputs stay blank.

## Server lifecycle

Each Server's `lifecycle` setting controls when it connects and whether it idles out. `lazy` remains the default.

- `lazy` (default): connects on the first tool-list or tool-call request and disconnects after the idle timeout; the next request reconnects it.
- `eager`: connects when the Adapter starts, when the Server is added or re-enabled, or when its connection Config changes, and still disconnects after the idle timeout.
- `keep-alive`: connects like `eager` but never idles out. When the connection closes unexpectedly, it reconnects after 30 seconds and keeps retrying every 30 seconds until it succeeds.
- `lazy-keep-alive`: connects on first use like `lazy`, but never idles out and auto-reconnects like `keep-alive`.

A `lazy` or `lazy-keep-alive` Server creates no connection at startup. The first tool-list or tool-call request connects the Server and fills an in-memory metadata cache. Promotion discovery is the single documented exception to this startup laziness ([ADR 0003](./docs/adr/0003-promotion-discovery-lazy-exception.md)): when the Adapter starts up or re-enables a Server whose Config lists Promotions, the registry performs exactly one connect to rebuild the native input schema, then the connection follows the normal idle behavior. MCP `tools/list_changed` notifications refresh the cache. The default idle timeout closes the connection after 10 minutes without a request; the next request reconnects it.

Changing, disabling, or removing a Server closes its connection, clears its cache, and cancels any pending keep-alive reconnect; a disabled Server never reconnects. Re-enabling a Server restores its configured lifecycle, so `eager` and `keep-alive` Servers connect again. A Connection RPC channel, `/mcp-adapter`, exposes detached `status`, `catalog`, and combined `overview` snapshots. Its `reconnect` endpoint restarts one named Server. These endpoints never expose Config secrets or SDK objects.

## Commands

The Host registers one human command, `/mcp`, with four subcommands. A bare `/mcp` or `/mcp status` prints one line per Server: name, live state, cached tool count, and the last message when one is present.

```text
/mcp                        # status of every Server
/mcp reconnect filesystem   # close and relist one Server now
/mcp disable hosted         # keep the Config, stop the Server
/mcp enable hosted          # restore the lazy lifecycle
```

`reconnect` mirrors the `/mcp-adapter` RPC endpoint: it closes the Server's current connection and lists tools so it reconnects. `enable` and `disable` write the global Config's `disabled` flag — the same write as **Settings > MCP** — and leave the Server entry otherwise untouched. An unknown Server, unknown subcommand, or missing argument answers with `Usage: /mcp [status|reconnect|enable|disable] [server]`.

## OAuth

Remote HTTP Servers can authenticate with OAuth 2.0 authorization code flow and PKCE instead of static headers. Set `auth: oauth` on the Server (and optionally `scopes`), then sign in from **Settings > MCP** — the detail panel shows the sign-in state and Sign in / Sign out buttons — or with the `/mcp-auth [server] [login|logout|status]` command (`/mcp-auth` alone lists every OAuth Server).

Sign in opens the provider's authorization page in your browser through the DSH web session. The Adapter listens on a local loopback callback, validates the state parameter, exchanges the code, and finishes the flow in the background; the Server then reconnects with the fresh tokens. The consent handoff never carries token material through the RPC channel.

Tokens live in `${DSH_HOME:-~/.dsh}/mcp-auth/tokens.json` (directory `0700`, file `0600`, atomic writes), one record per Server, bound to the Server URL they were issued for — changing the URL requires a fresh sign-in. The SDK transports refresh expired access tokens through the stored refresh token on the next 401; when no refresh token remains, the Server reports that it needs re-authorization instead of starting a browser flow on its own. Sign out deletes the record and disconnects the Server. Exactly one sign-in flow may run per Server at a time. See [ADR 0008](./docs/adr/0008-oauth-for-http-servers.md).

## Proxy Tool

The Host registers one global `mcp` tool with seven actions:

```text
mcp({ action: "search", query: "screenshot" })
mcp({ action: "describe", server: "browser", tool: "take_screenshot" })
mcp({ action: "call", server: "browser", tool: "take_screenshot", args: {} })
mcp({ action: "resources", server: "browser" })
mcp({ action: "read", server: "browser", uri: "file:///docs/readme.md" })
mcp({ action: "prompts", server: "browser" })
mcp({ action: "prompt", server: "browser", name: "review", args: { path: "src/index.js" } })
```

Search results use `<server>__<tool>` names to avoid collisions. The first search fills empty metadata caches; later search and describe operations use the cache. Call requests ask for DSH approval unless that Server has `autoAllow: true`.

All action output is limited to 50 KiB and 2,000 lines. Larger text uses `spillStore` for a full-result reference. Raw structured details larger than 16 KiB become a compact summary with their own spill reference.

## Promotion

Add a raw MCP tool name to a Server's `promotedTools` list to register `<server>__<tool>` as a native DSH tool. The native tool uses the MCP input schema and the same approval, call, and output-guard path as `mcp({ action: "call" })`.

Promotion changes apply through `settings/updated`. They do not restart a connected Server. Removing a Promotion unregisters its native tool. Non-promoted tools remain available only through the `mcp` Proxy Tool.

DSH native tool names must match `[A-Za-z0-9_-]` and contain at most 64 characters. The Adapter logs a warning and skips an invalid or colliding Promotion name.

## Resources and prompts

Servers that expose MCP resources and prompts surface through the `mcp` Proxy Tool. There are no per-resource native tools and no browse UI.

`mcp({ action: "resources", server: "docs" })` lists one Server's resources as `uri`, `name`, `description`, and `mimeType`, plus its resource templates when the Server exposes them. `mcp({ action: "read", server: "docs", uri: "..." })` reads one resource. Text content flows inline through the same output guard as tool calls.

Binary (`blob`) resource content is never inlined as base64. It is base64-decoded and written to a new `mcp-resource-` directory under the system temp folder; the file name is sanitized from the resource URI, and the result reports the file `path` and byte `size`.

`mcp({ action: "prompts", server: "docs" })` lists one Server's prompts as `name`, `description`, and `arguments`. `mcp({ action: "prompt", server: "docs", name: "review", args: {} })` fetches one prompt and formats its messages as `role: text` lines.

Prompts also surface as one human command on the DSH command registry:

```text
/mcp-prompt <server> <prompt> [json-args]
```

For example, `/mcp-prompt docs review {"path": "src/index.js"}`. Empty input, invalid JSON arguments, unknown Servers, and failed fetches answer with error text; success prints the formatted messages.

Resource and prompt metadata is never cached: every action connects lazily and hits the live Server, so results reflect the Server's current state and an offline Server fails with a setup hint.

## Install

Requires the `dsh` CLI and a web profile (the browser GUI you run DSH with).

```sh
dsh plugin --profile web add @auggieteo/dsh-mcp-adapter
```

Then restart DSH. The Settings panel (`⌘,` / sidebar foot) gains an **MCP** section.

### Local development

```sh
pnpm install
pnpm build          # produces lib/client.js (required before install)
dsh plugin --profile web add /absolute/path/to/dsh-mcp-adapter
```

During client development, run `pnpm dev` alongside DSH. `dsh-client-hmr` reloads each rebuilt client bundle without a manual refresh.

Host changes need a DSH restart. The web profile disables host HMR for plugin rows.

## Uninstall

```sh
dsh plugin --profile web remove @auggieteo/dsh-mcp-adapter
```

## Release

The package uses Semantic Versioning. Update `package.json` before each release.

```sh
pnpm version patch --no-git-tag-version  # or minor, major, or an explicit version
pnpm test
```

Merge the version change. Then publish a GitHub Release whose tag is exactly `v<package version>`.

The `Publish to npm` workflow rejects any different tag. It tests and builds the package before publishing with npm provenance.

A prerelease GitHub Release publishes with the npm `next` tag. A regular GitHub Release publishes with the npm `latest` tag.

The first publish creates the npm package. Add a short-lived granular npm token as the GitHub `NPM_TOKEN` secret for this publish.

Then configure npm trusted publishing for `auggie246/dsh-mcp-adapter` and `publish.yml`. Allow `npm publish`, then delete `NPM_TOKEN`.

Later releases use GitHub OIDC and need no long-lived npm token. npm requires the package to exist before trusted publishing configuration.

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
