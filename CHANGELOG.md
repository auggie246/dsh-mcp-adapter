# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

[v0.2.0]: https://github.com/auggie246/dsh-mcp-adapter/compare/v0.1.2...v0.2.0
[v0.1.2]: https://github.com/auggie246/dsh-mcp-adapter/releases/tag/v0.1.2
