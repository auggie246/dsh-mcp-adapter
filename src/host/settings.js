import z from '@deepseek-ai/schemastery'

import { errorMessage } from './errors.js'

// DSH 0.1.7 replaced the registered-namespace settings model with profile
// Loader-entry Config: the Adapter's configuration IS its entry Config, so
// the settings namespace identity is the entry id from cordis.patch.yml.
export const MCP_SETTINGS_NAMESPACE = 'mcp-adapter'

const optionalString = () => z.string().required(false)

export const McpServerSchema = z
  .object({
    // Standard mcpServers transport fields. command and url stay optional in
    // the serializable schema; validateMcpSettings enforces exactly one.
    command: optionalString().description('Executable for a stdio MCP server.'),
    args: z
      .array(z.string())
      .description('Arguments passed to the stdio server command.'),
    env: z
      .dict(z.string().role('secret'))
      .description('Environment variables passed to the stdio server.'),
    url: optionalString().description(
      'HTTP(S) endpoint for streamable HTTP with SSE fallback.',
    ),
    headers: z
      .dict(z.string().role('secret'))
      .description('Headers sent to the remote HTTP MCP server.'),
    auth: z
      .union(['headers', 'oauth'])
      .default('headers')
      .description('HTTP authentication mode: static headers, or OAuth 2.0 with PKCE.'),
    scopes: z
      .array(z.string())
      .default([])
      .description('OAuth scopes to request.'),

    // Adapter extensions. These fields remain paste-compatible with standard
    // clients because other clients ignore unknown per-server keys.
    disabled: z
      .boolean()
      .default(false)
      .description('Disable this server without deleting its Config.'),
    autoAllow: z
      .boolean()
      .default(false)
      .description('Run this server’s tool calls without DSH approval prompts.'),
    lifecycle: z
      .union(['lazy', 'eager', 'keep-alive', 'lazy-keep-alive'])
      .default('lazy')
      .description(
        'Connection lifecycle: lazy (connect on first use, disconnect after idle '
        + 'timeout), eager (connect at startup, idle timeout still applies), '
        + 'keep-alive (connect at startup, never idle out, auto-reconnect), or '
        + 'lazy-keep-alive (connect on first use, never idle out, auto-reconnect).',
      ),
    idleTimeoutMinutes: z
      .number()
      .default(10)
      .description('Disconnect after this many idle minutes.'),
    promotedTools: z
      .array(z.string())
      .default([])
      .description('MCP tool names promoted to native DSH tools.'),
  })
  .description('One configured MCP server.')

// Every Adapter-managed field is volatile: the Loader commits form edits into
// the running fiber without a restart, and the Settings page / profile editor
// may only write schema-declared volatile paths. Volatile fields must sit at
// fixed object paths, so the marks stay on the two top-level fields — server
// entries inside the dict cannot carry their own volatile marks.
export const McpConfigSchema = z.object({
  mcpServers: z
    .dict(McpServerSchema)
    .default({})
    .volatile()
    .description('Global MCP servers, keyed by their unique server name.'),
  skillInstall: z
    .union(['file', 'runtime', 'off'])
    .default('file')
    .volatile()
    .description(
      'How the bundled mcp-adapter agent skill is installed: file (copy to '
      + '$DSH_HOME/skills/mcp-adapter/ so Settings > Skills lists it; an '
      + 'existing file is never overwritten), runtime (register in memory '
      + 'only), or off (no skill). Read once at Adapter startup.',
    ),
})

const TOP_LEVEL_KEYS = new Set(['mcpServers', 'skillInstall'])
const SERVER_KEYS = new Set([
  'command',
  'args',
  'env',
  'url',
  'headers',
  'auth',
  'scopes',
  'disabled',
  'autoAllow',
  'lifecycle',
  'idleTimeoutMinutes',
  'promotedTools',
])
const RESERVED_SERVER_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`)
}

function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field')
  }
}

/**
 * Cross-field checks that the serializable Schemastery shape cannot express.
 * The old SettingsProvider ran this before every persist; the 0.1.7 Config
 * write path validates only the schema, so this runs at Host consumption
 * instead (the Adapter serves no Servers for a semantically invalid section).
 */
export function validateMcpSettings(value) {
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, 'mcp')

  for (const [serverName, server] of Object.entries(value.mcpServers)) {
    const path = `mcp.mcpServers.${serverName}`

    if (serverName.trim() === '') fail('mcp.mcpServers', 'server names cannot be empty')
    if (RESERVED_SERVER_NAMES.has(serverName)) {
      fail(path, 'reserved server name')
    }

    rejectUnknownKeys(server, SERVER_KEYS, path)

    const hasCommand = typeof server.command === 'string'
    const hasUrl = typeof server.url === 'string'
    if (hasCommand === hasUrl) {
      fail(path, 'configure exactly one transport: "command" (stdio) or "url" (HTTP)')
    }

    if (hasCommand) {
      if (server.command.trim() === '') fail(`${path}.command`, 'cannot be empty')
      if (Object.keys(server.headers).length > 0) {
        fail(`${path}.headers`, 'only HTTP servers may configure headers')
      }
    } else {
      if (server.url.trim() === '') fail(`${path}.url`, 'cannot be empty')
      let url
      try {
        url = new URL(server.url)
      } catch {
        fail(`${path}.url`, 'must be a valid absolute HTTP(S) URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        fail(`${path}.url`, 'must use http: or https:')
      }
      if (server.args.length > 0) {
        fail(`${path}.args`, 'only stdio servers may configure args')
      }
      if (Object.keys(server.env).length > 0) {
        fail(`${path}.env`, 'only stdio servers may configure env')
      }
    }

    if (server.auth === 'oauth' && !hasUrl) {
      fail(`${path}.auth`, 'OAuth requires the HTTP Transport (url)')
    }
    if (server.scopes.length > 0 && server.auth !== 'oauth') {
      fail(`${path}.scopes`, 'scopes require auth "oauth"')
    }

    if (
      !Number.isFinite(server.idleTimeoutMinutes) ||
      server.idleTimeoutMinutes <= 0
    ) {
      fail(`${path}.idleTimeoutMinutes`, 'must be a positive number')
    }

    const seenTools = new Set()
    for (const toolName of server.promotedTools) {
      if (toolName.trim() === '') {
        fail(`${path}.promotedTools`, 'tool names cannot be empty')
      }
      if (seenTools.has(toolName)) {
        fail(`${path}.promotedTools`, `duplicate tool name ${JSON.stringify(toolName)}`)
      }
      seenTools.add(toolName)
    }
  }
}

// Cosmokit identifies volatile references across library copies through this
// shared symbol; reading it directly keeps the Host free of a cosmokit import.
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function unwrapVolatile(value, fallback) {
  if (typeof value === 'object' && value !== null && VOLATILE_WRITE in value) {
    return value.get()
  }
  return value ?? fallback
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

/**
 * Read the live Adapter Config from the fiber and enforce the cross-field
 * rules. A section that schemastery accepts but these rules reject fails
 * closed to an empty server list with one deduplicated warning, so a
 * hand-edited profile can never brick the connection manager.
 */
export function readMcpConfig(config = {}, onInvalid) {
  const value = {
    ...config,
    mcpServers: unwrapVolatile(config.mcpServers, {}),
    skillInstall: unwrapVolatile(config.skillInstall, 'file'),
  }
  try {
    // Validation sees the whole resolved Config, so unknown fields still
    // reject the section; the returned value only carries declared fields.
    validateMcpSettings(value)
    return { mcpServers: value.mcpServers, skillInstall: value.skillInstall }
  } catch (error) {
    onInvalid?.(errorMessage(error))
    return { mcpServers: {}, skillInstall: 'file' }
  }
}

/**
 * Wrap the fiber's volatile entry Config in the scope surface every Adapter
 * feature consumes (the same { get, watch, update, mutate } the old settings
 * scope provided):
 *  - `get()` unwraps the volatile references and fail-closes on invalid data;
 *  - `watch(listener)` fires `(next, previous)` after committed volatile
 *    updates (`loader/volatile-update`) whose value actually changed;
 *  - `update(patch)` / `mutate(ops)` write through the settings service onto
 *    this entry and throw when no settings service is mounted.
 *
 * `config` is the validated Config cordis hands the plugin as the second
 * `apply` argument. Schema-declared volatile fields are stable references
 * inside that object and the Loader commits edits into them in place, so the
 * object stays live for the whole activation (an ordinary edit restarts the
 * entry instead). It is the only way to read the entry Config: cordis has no
 * `config` service, so touching `ctx.config` throws
 * `cannot get property "config" without inject`.
 */
export function createMcpConfigScope(ctx, config, options = {}) {
  const warn = options.warn ?? ((message) => ctx.logger?.warn?.(message))
  const settingsService = options.settings ?? (() => ctx.get('settings'))
  const listeners = new Set()
  let warnedInvalid
  let last = readCurrent()

  function readCurrent() {
    return readMcpConfig(config, (message) => {
      if (message === warnedInvalid) return
      warnedInvalid = message
      warn(`dsh-mcp-adapter: invalid MCP Config, serving no Servers: ${message}`)
    })
  }

  const off = ctx.on('loader/volatile-update', () => {
    const next = readCurrent()
    if (stableJson(next) === stableJson(last)) return
    const previous = last
    last = next
    for (const listener of [...listeners]) {
      try {
        listener(next, previous)
      } catch {
        // A stale or failing listener must not break Config notification.
      }
    }
  })

  function requireSettings(method) {
    const settings = settingsService()
    if (settings === undefined) {
      throw new Error(
        `dsh-mcp-adapter: settings ${method} unavailable: the DSH settings service is not `
        + 'mounted in this profile, so MCP Config cannot be written.',
      )
    }
    return settings
  }

  return {
    get: () => readCurrent(),
    watch(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(patch) {
      return requireSettings('update').update(MCP_SETTINGS_NAMESPACE, patch)
    },
    mutate(ops) {
      return requireSettings('mutate').mutate(MCP_SETTINGS_NAMESPACE, ops)
    },
    dispose() {
      off?.()
      listeners.clear()
    },
  }
}
