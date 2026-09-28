# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.4.2] - 2026-09-28

### Fixed

- Settings > MCP loads again on DSH 0.1.7 instead of showing `Could not load MCP status: transport failure for /mcp-adapter/overview: HTTP 405`. The status RPC was a dedicated `connection.rpc.handle('/mcp-adapter', …)` channel, but DSH 0.1.7 mounts such channels with `owner.webServer.register` on the connection provider's own fiber, and cordis 4 refuses that un-injected property read — the channel silently never registered and the SPA static fallback answered every POST with 405 (the `mcp-adapter` plugin row still reads `active`; only a Host console line shows the failure). The RPC surface now mounts each endpoint as an exact Fetch route on the shared `/api` channel through the documented `connection.fetch.register` seam — the platform still applies browser authentication and the origin fence before the handler runs — and the Client calls `connection.rpc.call('/api', 'mcp-adapter/<endpoint>')`; envelopes and the page are otherwise unchanged. `test/rpc-fetch-routes.test.js` pins the mount and the dispose/remount lifecycle through a real cordis fiber, which the old `rpc.handle` fakes could not see. [ADR 0011](docs/adr/0011-rpc-on-shared-api-fetch-routes.md).

## [v0.4.1] - 2026-09-28

### Fixed

- The Host entry no longer dies on start with `Error: cannot get property "config" without inject`. v0.4.0 read the Adapter's Loader-entry Config from `ctx.config`, but cordis 4 has no `config` service or accessor — the context proxy refuses any property the plugin did not declare in `inject`, so every DSH start that mounted the `mcp-adapter` entry threw inside `createMcpConfigScope` and the Adapter never came up. The validated Config is the second `apply` argument (`apply(ctx, config)`, the shape the shipped DSH plugins use), and its volatile fields are references the Loader commits through in place, so the scope stays live for the whole activation. `createMcpConfigScope(ctx, config)` now takes it explicitly; `test/settings.test.js` pins the contract against a real cordis fiber and its fakes refuse a `config` context property the way the proxy does. [ADR 0010](docs/adr/0010-loader-entry-config-model.md) records the correction.

## [v0.4.0] - 2026-09-27

### Added

- One-time legacy import: after the Loader settles on DSH 0.1.7, a still-untouched `mcp-adapter` entry adopts the legacy `mcp:` section of the profile's `settings.yaml` (validated, then written through the settings service once, with a `mcp-adapter.legacy-imported` marker in the profile home so clearing every Server never resurrects the old list). Failures warn with manual copy instructions and never throw. `test/legacy-import.test.js`.

### Changed

- **Breaking: DSH 0.1.7 only.** The settings model the Adapter was built on is gone in 0.1.7 — `ctx.settings.register(namespace, schema)` was replaced by profile Loader-entry Config — and carrying the old generations alongside it would have meant two parallel settings subsystems, so support drops to DSH `0.1.7-rc.1` and newer (peer `@deepseek-ai/dsh-settings` `^0.1.7-rc.1`, `@deepseek-ai/schemastery` `^3.18.4`; stay on v0.3.x for older harnesses). The host half now exports `Config` with `mcpServers` and `skillInstall` marked volatile, reads live values off `ctx.config` (committed without a fiber restart via `loader/volatile-update`), and writes through `ctx.settings`; `createMcpConfigScope` keeps the `{ get, watch, update, mutate }` surface all consumers use. The settings namespace identity is the Loader entry id: `mcp-adapter` (was `mcp`). `src/host/index.js`, [ADR 0010](docs/adr/0010-loader-entry-config-model.md).
- The client reads the entry through the `configForms` service (`configForms.get('mcp-adapter')` plus the shared `describe()` mirror) instead of the removed `settingsScope`; the `settings.section` page, the `remote.settings` positional wire, and its `{ ok, value | error }` envelope are unchanged. An entry whose mirrored value fails the schema now shows an explicit invalid state instead of a permanent spinner.
- Cross-field validation moved from before-persist (the removed settings provider hook) to Host consumption: a Config section that passes schemastery but violates the transport rules serves no Servers with one deduplicated warning, so hand-edited profile Config cannot brick the manager.
- `test/client-apply.test.js` collapses to a single 0.1.7 generation fake pinning the `mcp-adapter` entry id on the wire.

### Removed

- The DSH 0.1.1-rc.2 `connection.api.settings` client fallback, the 0.1.2/0.1.5 generation fakes, and the dead `@deepseek-ai/dsh-client-runtime` entry (last published for 0.1.1) from `dsh.client.inject`.
- The `installMcpSettings` export (replaced by `createMcpConfigScope`); the nav-icon patch script now targets 0.1.7's renamed `*Medium` icon members with `IconLinkOutlineMedium` as the default.

## [v0.3.0] - 2026-09-13

### Changed

- The peer dependency accepts `@deepseek-ai/dsh-settings` `^0.1.5-rc.1`, from the 0.1.2-rc.1 → 0.1.5-rc.2 compatibility check: every surface the Adapter uses (the `remote.settings` write face, `connection.rpc`, `tools.register`, `commands.register`, the `settings.section` slot) is unchanged in that range, so this is a declaration fix only. `test/client-apply.test.js` adds a 0.1.5-rc.1 generation fake locking the identical positional write shape ([ADR 0009](docs/adr/0009-dual-generation-settings-api.md)).

## [v0.2.2] - 2026-09-06

### Added

- `skillInstall` Config field (`file` by default, `runtime`, or `off`) controlling how the bundled `mcp-adapter` agent skill is installed. `file` copies `skills/mcp-adapter/SKILL.md` verbatim to `$DSH_HOME/skills/mcp-adapter/SKILL.md` at startup (atomic temp-file-then-rename write, never a symlink), so the DSH filesystem skill provider lists it under Settings > Skills > DSH skills. `runtime` keeps the previous in-memory registration; `off` installs nothing. The mode is read once at Adapter startup.

### Changed

- The bundled agent skill now installs as a real file by default instead of registering only in memory. The installed file is never overwritten: an identical file is left untouched, and a file edited by a human wins with one Host warning naming the installed path and the package version — delete `$DSH_HOME/skills/mcp-adapter/` and restart DSH to refresh it from the package. A failed file install (for example a read-only `$DSH_HOME`) falls back to the runtime registration with a warning; the skill stays a convenience and never throws.

## [v0.2.1] - 2026-09-06

### Added

- `scripts/patch-dsh-settings-nav-icon.mjs`: patches the installed DSH settings shell so the `mcp` nav row in Settings shows a connection icon (`IconLinkOutline16`) instead of the generic settings-gear fallback. The icon mapping is DSH shell chrome that this plugin cannot reach through the `settings.section` slot (it accepts only `id`, `order`, `label`). The insert is idempotent and marked `// dsh-mcp-adapter`; `--revert` restores the original bytes. A DSH upgrade replaces the patched file, so re-run the script afterwards, then restart `dsh web` and refresh the page.

### Changed

- Settings > MCP has a single Add Server entry point: the dialog now offers an Input fields mode for one Server and a Paste JSON mode for a standard `mcpServers` object (existing names are replaced), replacing the separate Import JSON button and dialog in both the toolbar and the empty state.

### Fixed

- The plugin failed to load on DSH 0.1.2-rc.1 with `failed to apply loader entry … cannot get property "remote.settings" without inject`: the runner mounts the settings namespace as the traced dotted service `remote.settings`, so the plain `ctx.remote?.settings` read is governed and throws for plugins that do not declare it — while declaring it would park the plugin forever on 0.1.1-rc.2, where the namespace is never mounted. The write face is now resolved through the inject-free `ctx.get('remote.settings')`, which works on both generations ([ADR 0009](docs/adr/0009-dual-generation-settings-api.md)).
- The Add Server and Import JSON dialogs follow the host dialog theme again: the modal card now surfaces on `bg-layer-2` with the shared `--dsw-elevation-prominent` treatment and the overlay mask blurs like the host Modal primitive, instead of the off-palette `bg-overlay` fill and a hardcoded drop shadow.

## [v0.2.0] - 2026-09-05

Everything from v0.1.2 through this release: the six deferred v1 features (#8–#12, #14), the dual-generation DSH compatibility fix, and the standard-readme documentation pass.

### Added

- OAuth 2.0 authorization code flow with PKCE for remote HTTP Servers (#8): `auth: oauth`, optional `scopes`, sign-in from Settings > MCP or `/mcp-auth`, a local loopback callback, and token records in `~/.dsh/mcp-auth/tokens.json`.
- OAuth sign-in state surfaced in the MCP settings UI, with Sign in / Sign out per Server and `oauth-status`/`oauth-login`/`oauth-logout` RPC endpoints.
- Per-workspace Config layering (#10, [ADR 0005](docs/adr/0005-per-workspace-config.md)): `.dsh/mcp.json` in the workspace root merges over the global namespace at resolve time and overrides same-named Servers.
- MCP resources and prompts through the Proxy Tool (`resources`, `read`, `prompts`, `prompt` actions) plus the `/mcp-prompt` human command (#9).
- The `/mcp` human command family (#11): `status`, `reconnect`, `enable`, and `disable`.
- `eager`, `keep-alive`, and `lazy-keep-alive` lifecycle modes alongside `lazy` (#12, [ADR 0004](docs/adr/0004-lifecycle-modes.md)), including keep-alive auto-reconnect after unexpected closes.
- A bundled `mcp-adapter` agent skill (`skills/mcp-adapter/SKILL.md`) registered as a runtime skill when the DSH `skills` service is present.
- `layers` Connection RPC endpoint reporting the workspace-vs-global source of each Server's Config.

### Changed

- Support DSH 0.1.2-rc.1 and 0.1.1-rc.2 simultaneously: the client resolves the settings write face at apply time (`remote.settings` on 0.1.2-rc.1+, `connection.api.settings` on 0.1.1-rc.2) ([ADR 0009](docs/adr/0009-dual-generation-settings-api.md)); the peer dependency widened to `^0.1.1-rc.2 || ^0.1.2-rc.1`.
- MCP RPC failure envelopes use the platform's error codes, so error messages reach the UI instead of being rejected by the client-side schema.
- README restructured to the [standard-readme](https://github.com/RichardLitt/standard-readme) layout, with a Compatibility section, a Security section, and the package description aligned to the spec's short-description limit.
- Promotion discovery documented as the single Lazy Lifecycle startup exception ([ADR 0003](docs/adr/0003-promotion-discovery-lazy-exception.md)).

### Fixed

- Plugin load on DSH 0.1.2-rc.1 crashed the web client with `can't access property "settings", ctx.connection.api is undefined` because the connection service lost its `api` face; the settings write face is now resolved across both harness generations (see Changed).
- The host imported `settingsNamespace`, an export removed from `@deepseek-ai/dsh-settings` 0.1.2-rc.1; the `mcp` namespace now registers as a plain string, which both releases accept.

## [v0.1.2] - 2026-08-31

### Changed

- Restyle the MCP Settings page to the host theme and fix layout overflow.

## [v0.1.1] and earlier

Initial releases of the Adapter through v1 issues #1–#7: proxy-first tool surface, Config in the DSH settings namespace, promotion registry, lazy lifecycle, output guard, settings page, and the `/mcp-adapter` RPC channel. See [docs/verification/v1-e2e.md](docs/verification/v1-e2e.md).

[v0.2.2]: https://github.com/auggie246/dsh-mcp-adapter/compare/v0.2.1...v0.2.2
[v0.2.0]: https://github.com/auggie246/dsh-mcp-adapter/compare/v0.1.2...v0.2.0
[v0.1.2]: https://github.com/auggie246/dsh-mcp-adapter/releases/tag/v0.1.2
