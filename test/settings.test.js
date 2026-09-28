import assert from 'node:assert/strict'
import test from 'node:test'

import { redactSecrets } from '@deepseek-ai/dsh-settings'

import * as Adapter from '../src/host/index.js'
import {
  createMcpConfigScope,
  MCP_SETTINGS_NAMESPACE,
  McpConfigSchema,
  readMcpConfig,
  validateMcpSettings,
} from '../src/host/settings.js'

// The 0.1.7 Config model wraps every schema-declared volatile field in a
// cosmokit reference; this mirrors what the Host reads from the entry Config.
function resolve(value) {
  const resolved = McpConfigSchema(value)
  const plain = {
    ...resolved,
    mcpServers: resolved.mcpServers.get(),
    skillInstall: resolved.skillInstall.get(),
  }
  validateMcpSettings(plain)
  return { mcpServers: plain.mcpServers, skillInstall: plain.skillInstall }
}

// cordis resolves a volatile field into a frozen reference read through
// `get()` and written only through cosmokit's shared write member — the same
// symbol the Host uses to recognise a reference.
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function volatileRef(value) {
  let current = value
  return Object.freeze({
    get: () => current,
    [VOLATILE_WRITE]: (next) => (current = next),
  })
}

// A resolved entry Config shaped like the object cordis hands `apply`.
function fakeConfig(value = {}) {
  const resolved = McpConfigSchema(value)
  return {
    mcpServers: volatileRef(resolved.mcpServers.get()),
    skillInstall: volatileRef(resolved.skillInstall.get()),
  }
}

// What cordis-plugin-loader does on a committed volatile update: re-resolve
// the new raw Config and push the value through the reference the running
// fiber already holds.
function commitVolatile(ref, value) {
  ref[VOLATILE_WRITE](value)
}

function resolvedServers(value) {
  return McpConfigSchema({ mcpServers: value }).mcpServers.get()
}

// The Host fiber context, minus Config: cordis 4 resolves every context
// property through its proxy and refuses anything the plugin did not declare
// in `inject`, and `config` is not a service. A fake that carried Config on
// the context would hide the crash it is supposed to catch.
function fakeHostCtx({ settings } = {}) {
  const handlers = new Map()
  const warnings = []
  const target = {
    logger: { warn: (message) => warnings.push(message) },
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    emit(event, ...args) {
      handlers.get(event)?.(...args)
    },
    get: (name) => (name === 'settings' ? settings : undefined),
  }
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'config') throw new Error('cannot get property "config" without inject')
      return obj[prop]
    },
  })
  return { ctx, warnings }
}

test('the plugin exports its Config schema with both managed fields volatile', () => {
  assert.equal(Adapter.Config, McpConfigSchema)
  assert.equal(McpConfigSchema.dict.mcpServers.meta.volatile, true)
  assert.equal(McpConfigSchema.dict.skillInstall.meta.volatile, true)
  assert.equal(MCP_SETTINGS_NAMESPACE, 'mcp-adapter')
})

test('resolves an absent Config to an empty server list and the default skill mode', () => {
  assert.deepEqual(resolve({}), { mcpServers: {}, skillInstall: 'file' })
})

test('resolves standard stdio Config and Adapter defaults', () => {
  assert.deepEqual(
    resolve({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: { LOG_LEVEL: 'warn' },
        },
      },
    }),
    {
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: { LOG_LEVEL: 'warn' },
          headers: {},
          auth: 'headers',
          scopes: [],
          disabled: false,
          autoAllow: false,
          lifecycle: 'lazy',
          idleTimeoutMinutes: 10,
          promotedTools: [],
        },
      },
      skillInstall: 'file',
    },
  )
})

test('resolves standard HTTP Config with bearer headers', () => {
  const config = resolve({
    mcpServers: {
      linear: {
        url: 'https://mcp.example.test/api',
        headers: { Authorization: 'Bearer test-token' },
        autoAllow: true,
        promotedTools: ['list_issues'],
      },
    },
  })

  assert.equal(config.mcpServers.linear.url, 'https://mcp.example.test/api')
  assert.equal(config.mcpServers.linear.autoAllow, true)
  assert.equal(config.mcpServers.linear.auth, 'headers')
  assert.deepEqual(config.mcpServers.linear.scopes, [])
  assert.deepEqual(config.mcpServers.linear.args, [])
  assert.deepEqual(config.mcpServers.linear.env, {})
})

test('resolves OAuth Config for remote HTTP Servers', () => {
  const config = resolve({
    mcpServers: {
      linear: {
        url: 'https://mcp.example.test/api',
        auth: 'oauth',
        scopes: ['read', 'write'],
      },
    },
  })
  assert.equal(config.mcpServers.linear.auth, 'oauth')
  assert.deepEqual(config.mcpServers.linear.scopes, ['read', 'write'])
  assert.deepEqual(config.mcpServers.linear.headers, {})
})

test('rejects OAuth on stdio Servers and scopes without OAuth', () => {
  assert.throws(
    () => resolve({ mcpServers: { local: { command: 'node', auth: 'oauth' } } }),
    /mcp\.mcpServers\.local\.auth: OAuth requires the HTTP Transport/,
  )
  assert.throws(
    () =>
      resolve({
        mcpServers: {
          remote: { url: 'https://mcp.example.test/api', scopes: ['read'] },
        },
      }),
    /mcp\.mcpServers\.remote\.scopes: scopes require auth "oauth"/,
  )
  assert.throws(
    () =>
      resolve({
        mcpServers: { remote: { url: 'https://mcp.example.test/api', auth: 'basic' } },
      }),
    /auth/,
  )
})

test('redacts secret values while preserving their editable key paths', () => {
  const config = {
    mcpServers: {
      stdio: { command: 'node', env: { API_TOKEN: 'secret' } },
      remote: {
        url: 'https://mcp.example.test/api',
        headers: { Authorization: 'Bearer secret' },
      },
    },
  }
  const redacted = redactSecrets(McpConfigSchema, config)
  assert.deepEqual(redacted.value.mcpServers.stdio.env, {})
  assert.deepEqual(redacted.value.mcpServers.remote.headers, {})
  assert.deepEqual(
    redacted.secrets.map((secret) => secret.path),
    [
      ['mcpServers', 'stdio', 'env', 'API_TOKEN'],
      ['mcpServers', 'remote', 'headers', 'Authorization'],
    ],
  )
})

test('requires exactly one transport with actionable paths', () => {
  assert.throws(
    () => resolve({ mcpServers: { broken: {} } }),
    /mcp\.mcpServers\.broken: configure exactly one transport/,
  )
  assert.throws(
    () =>
      resolve({
        mcpServers: {
          broken: { command: 'node', url: 'https://example.test/mcp' },
        },
      }),
    /mcp\.mcpServers\.broken: configure exactly one transport/,
  )
})

test('rejects unknown fields at their exact path', () => {
  assert.throws(
    () => resolve({ mcpServers: {}, imports: [] }),
    /mcp\.imports: unknown field/,
  )
  assert.throws(
    () => resolve({ mcpServers: { demo: { command: 'node', timeout: 10 } } }),
    /mcp\.mcpServers\.demo\.timeout: unknown field/,
  )
})

test('rejects invalid or mismatched transport details', () => {
  assert.throws(
    () => resolve({ mcpServers: { remote: { url: 'file:///tmp/mcp' } } }),
    /must use http: or https:/,
  )
  assert.throws(
    () => resolve({ mcpServers: { local: { command: 'node', headers: { X: '1' } } } }),
    /only HTTP servers may configure headers/,
  )
  assert.throws(
    () => resolve({ mcpServers: { remote: { url: 'https://example.test', args: ['x'] } } }),
    /only stdio servers may configure args/,
  )
})

test('accepts every skillInstall mode and rejects invalid ones', () => {
  for (const skillInstall of ['file', 'runtime', 'off']) {
    const config = resolve({ mcpServers: {}, skillInstall })
    assert.equal(config.skillInstall, skillInstall)
  }
  assert.throws(
    () => resolve({ mcpServers: {}, skillInstall: 'always' }),
    /expected "file" \| "runtime" \| "off" but got "always"/,
  )
})

test('accepts every lifecycle value and rejects invalid ones', () => {
  for (const lifecycle of ['lazy', 'eager', 'keep-alive', 'lazy-keep-alive']) {
    const config = resolve({ mcpServers: { demo: { command: 'node', lifecycle } } })
    assert.equal(config.mcpServers.demo.lifecycle, lifecycle)
  }
  assert.throws(
    () => resolve({ mcpServers: { demo: { command: 'node', lifecycle: 'aggressive' } } }),
    /expected "lazy" \| "eager" \| "keep-alive" \| "lazy-keep-alive" but got "aggressive"/,
  )
  assert.throws(
    () => resolve({ mcpServers: { demo: { command: 'node', idleTimeoutMinutes: 0 } } }),
    /idleTimeoutMinutes: must be a positive number/,
  )
  assert.throws(
    () => resolve({ mcpServers: { demo: { command: 'node', promotedTools: ['read', 'read'] } } }),
    /duplicate tool name "read"/,
  )
})

test('readMcpConfig unwraps volatile refs and fail-closes on invalid sections', () => {
  const valid = readMcpConfig(
    McpConfigSchema({ mcpServers: { demo: { command: 'node' } }, skillInstall: 'runtime' }),
  )
  assert.equal(valid.mcpServers.demo.command, 'node')
  assert.equal(valid.skillInstall, 'runtime')

  const invalid = []
  const broken = readMcpConfig(
    McpConfigSchema({ mcpServers: { broken: { command: 'node', url: 'https://x.test' } } }),
    (message) => invalid.push(message),
  )
  assert.deepEqual(broken, { mcpServers: {}, skillInstall: 'file' })
  assert.match(invalid.join('\n'), /configure exactly one transport/)

  // Unknown profile fields reject the section too, even though the read
  // returns only declared fields.
  assert.deepEqual(
    readMcpConfig({ ...McpConfigSchema({}), imports: [] }, () => {}),
    { mcpServers: {}, skillInstall: 'file' },
  )
})

test('the scope serves unwrapped Config and watches committed volatile updates', () => {
  const config = fakeConfig({ mcpServers: { demo: { command: 'node' } } })
  const { ctx } = fakeHostCtx()
  const scope = createMcpConfigScope(ctx, config)

  assert.deepEqual(scope.get().mcpServers.demo.command, 'node')

  const seen = []
  scope.watch((next, previous) => seen.push([next, previous]))

  // A committed volatile update writes through the reference the scope already
  // holds; the scope reports the changed value with its predecessor.
  commitVolatile(config.mcpServers, resolvedServers({ demo: { command: 'node' }, added: { url: 'https://x.test/api' } }))
  ctx.emit('loader/volatile-update', [['mcpServers']])
  assert.equal(seen.length, 1)
  assert.deepEqual(Object.keys(seen[0][0].mcpServers).sort(), ['added', 'demo'])
  assert.deepEqual(Object.keys(seen[0][1].mcpServers), ['demo'])

  // A volatile commit that changes nothing notifies nobody.
  ctx.emit('loader/volatile-update', [['mcpServers']])
  assert.equal(seen.length, 1)

  scope.dispose()
})

test('scope writes land on the settings service under the entry id', async () => {
  const calls = []
  const settings = {
    update: async (ns, patch) => calls.push(['update', ns, patch]),
    mutate: async (ns, ops) => calls.push(['mutate', ns, ops]),
  }
  const { ctx } = fakeHostCtx({ settings })
  const scope = createMcpConfigScope(ctx, fakeConfig())

  await scope.update({ mcpServers: { demo: { disabled: true } } })
  await scope.mutate([{ op: 'unset', path: ['mcpServers', 'demo'] }])
  assert.deepEqual(calls, [
    ['update', 'mcp-adapter', { mcpServers: { demo: { disabled: true } } }],
    ['mutate', 'mcp-adapter', [{ op: 'unset', path: ['mcpServers', 'demo'] }]],
  ])
  scope.dispose()
})

test('scope writes explain the missing settings service instead of crashing obscurely', () => {
  const { ctx, warnings } = fakeHostCtx()
  const scope = createMcpConfigScope(ctx, fakeConfig())
  assert.throws(() => scope.update({ mcpServers: {} }), /settings service is not mounted/)
  assert.deepEqual(warnings, [])
  scope.dispose()
})

test('an invalid Config warns once and serves an empty server list', () => {
  const config = McpConfigSchema({
    mcpServers: { broken: { command: 'node', url: 'https://x.test/api' } },
  })
  const { ctx, warnings } = fakeHostCtx()
  const scope = createMcpConfigScope(ctx, config)

  assert.deepEqual(scope.get(), { mcpServers: {}, skillInstall: 'file' })
  scope.get()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /invalid MCP Config, serving no Servers/)
  scope.dispose()
})

// The reported crash: cordis has no `config` service, so a Host reaching for
// `ctx.config` dies on start with `cannot get property "config" without
// inject`. Mount the Adapter's plugin shape through a real cordis fiber and
// pin the contract the Host actually relies on.
test('the entry Config arrives as the apply argument, never as a context property', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const probe = {
    name: 'mcp-config-probe',
    inject: [],
    Config: McpConfigSchema,
    apply(fiberCtx, config) {
      const scope = createMcpConfigScope(fiberCtx, config)
      let configProperty
      try {
        configProperty = fiberCtx.config
      } catch (error) {
        configProperty = error.message
      }
      probe.reads = [Object.keys(scope.get().mcpServers), configProperty]
      fiberCtx.effect(() => scope.dispose(), 'mcp-config-probe: config scope')
    },
  }

  const ctx = new Context()
  ctx.plugin(probe, { mcpServers: { demo: { command: 'node' } } })
  await ctx.provide()
  ctx.fiber.dispose()

  assert.deepEqual(probe.reads, [['demo'], 'cannot get property "config" without inject'])
})
