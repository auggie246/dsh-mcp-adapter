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
