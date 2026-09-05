import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, redactSecrets } from '@deepseek-ai/dsh-settings'

import * as Adapter from '../src/host/index.js'
import {
  MCP_SETTINGS_NAMESPACE,
  McpSettingsSchema,
  validateMcpSettings,
} from '../src/host/settings.js'

function resolve(value) {
  const resolved = McpSettingsSchema(value)
  validateMcpSettings(resolved)
  return resolved
}

class MemorySettings extends SettingsProvider {
  writable = true
  document = {}

  async load() {
    return structuredClone(this.document)
  }

  async persist(ns, section) {
    this.document[ns] = structuredClone(section)
  }
}

test('resolves an absent Config to an empty server list', () => {
  assert.deepEqual(resolve({}), { mcpServers: {} })
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
  const config = resolve({
    mcpServers: {
      stdio: { command: 'node', env: { API_TOKEN: 'secret' } },
      remote: {
        url: 'https://mcp.example.test/api',
        headers: { Authorization: 'Bearer secret' },
      },
    },
  })
  const redacted = redactSecrets(McpSettingsSchema, config)
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

test('rejects invalid lifecycle values, idle timeouts, and promotions', () => {
  assert.throws(
    () => resolve({ mcpServers: { demo: { command: 'node', lifecycle: 'eager' } } }),
    /expected "lazy"/,
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

test('registers mcp, round-trips a valid update, and emits settings/updated', async () => {
  const root = new Context()
  const updates = []
  root.on('settings/updated', (ns, next, prev, source) => {
    updates.push({ ns, next, prev, source })
  })

  try {
    await root.plugin(MemorySettings)
    await root.plugin(Adapter)

    const settings = root.get('settings')
    const initial = settings.describe().find(({ ns }) => ns === MCP_SETTINGS_NAMESPACE)
    assert.ok(initial)
    assert.deepEqual(initial.value, { mcpServers: {} })
    assert.equal(initial.applies, 'live')

    await settings.update(MCP_SETTINGS_NAMESPACE, {
      mcpServers: { demo: { command: 'node', args: ['server.js'] } },
    })

    const updated = settings.describe().find(({ ns }) => ns === MCP_SETTINGS_NAMESPACE)
    assert.equal(updated.revision, 1)
    assert.equal(updated.value.mcpServers.demo.command, 'node')
    assert.deepEqual(settings.document.mcp.mcpServers.demo.args, ['server.js'])
    assert.equal(updates.length, 1)
    assert.equal(updates[0].ns, MCP_SETTINGS_NAMESPACE)
    assert.equal(updates[0].source, 'update')

    await assert.rejects(
      settings.update(MCP_SETTINGS_NAMESPACE, {
        mcpServers: { demo: { command: 'node', url: 'https://example.test' } },
      }),
      /configure exactly one transport/,
    )
    assert.equal(settings.describe().find(({ ns }) => ns === MCP_SETTINGS_NAMESPACE).revision, 1)
  } finally {
    await root.fiber.dispose()
  }
})
