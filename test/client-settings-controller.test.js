import assert from 'node:assert/strict'
import test from 'node:test'

import {
  McpSettingsController,
  normalizeServerConfig,
  parseArgs,
  parseMcpImport,
  secretKeysFromView,
  secretRowOps,
  serverSource,
} from '../src/client/settings-controller.js'

test('normalizes standard imports and rejects invalid transport shapes', () => {
  assert.deepEqual(
    parseMcpImport(JSON.stringify({
      mcpServers: {
        fixture: { command: 'node', args: ['server.mjs'], env: { TOKEN: 'secret' } },
        remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer x' } },
      },
    })),
    {
      fixture: {
        command: 'node',
        args: ['server.mjs'],
        env: { TOKEN: 'secret' },
        disabled: false,
        autoAllow: false,
        lifecycle: 'lazy',
        idleTimeoutMinutes: 10,
        promotedTools: [],
      },
      remote: {
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer x' },
        disabled: false,
        autoAllow: false,
        lifecycle: 'lazy',
        idleTimeoutMinutes: 10,
        promotedTools: [],
      },
    },
  )
  assert.deepEqual(parseArgs('["one", "two"]'), ['one', 'two'])
  assert.throws(() => parseMcpImport('{'), /Invalid JSON/)
  assert.throws(
    () => normalizeServerConfig('bad', { command: 'node', url: 'https://example.test' }),
    /exactly one/,
  )
})

test('secret metadata exposes keys while path operations preserve blank existing values', () => {
  const view = {
    namespaces: [{
      ns: 'mcp',
      secrets: [
        { path: ['mcpServers', 'fixture', 'env', 'API_TOKEN'], set: true },
        { path: ['mcpServers', 'fixture', 'env', 'REMOVED'], set: false },
      ],
    }],
  }
  assert.deepEqual(secretKeysFromView(view, 'fixture', 'env'), ['API_TOKEN'])
  assert.deepEqual(
    secretRowOps(
      'fixture',
      'env',
      [
        { originalKey: 'API_TOKEN', key: 'API_TOKEN', value: '' },
        { key: 'NEW_TOKEN', value: 'new secret' },
      ],
      ['API_TOKEN'],
    ),
    [{
      op: 'set',
      path: ['mcpServers', 'fixture', 'env', 'NEW_TOKEN'],
      value: 'new secret',
    }],
  )
  assert.deepEqual(
    secretRowOps(
      'fixture',
      'env',
      [
        { originalKey: 'A', key: 'B', value: 'new B' },
        { originalKey: 'B', key: 'A', value: 'new A' },
      ],
      ['A', 'B'],
    ).map((op) => `${op.op}:${op.path.at(-1)}`),
    ['unset:A', 'unset:B', 'set:B', 'set:A'],
  )
})

test('serverSource reads the workspace layer snapshot with a global fallback', () => {
  assert.equal(serverSource({ source: { fixture: 'workspace' } }, 'fixture'), 'workspace')
  assert.equal(serverSource({ source: { fixture: 'global' } }, 'fixture'), 'global')
  assert.equal(serverSource({ source: {} }, 'fixture'), 'global')
  assert.equal(serverSource(undefined, 'fixture'), 'global')
})

test('controller loads the workspace layer snapshot through the Connection RPC', async () => {
  const endpoints = []
  const listeners = new Set()
  let scopeSnapshot = {
    status: 'ready',
    value: { mcpServers: { fixture: { command: 'node', args: [] } } },
    base: undefined,
    user: {},
    revision: 3,
    writable: true,
    mode: 'host',
  }
  let describeSnapshot = {
    status: 'ready',
    view: { writable: true, hasDocument: true, namespaces: [] },
    error: null,
  }
  const scope = {
    getSnapshot: () => scopeSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const describe = {
    getSnapshot: () => describeSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async ensure() {},
    acceptView() {},
  }
  const settingsApi = {
    async mutate(payload) {
      return {
        result: {
          ok: true,
          value: {
            ns: 'mcp',
            schema: {},
            value: {},
            applies: 'live',
            secrets: [],
            revision: payload.expectedRevision + 1,
          },
        },
      }
    },
  }
  const controller = new McpSettingsController({
    scope,
    describe,
    settingsApi,
    rpc: async (endpoint) => {
      endpoints.push(endpoint)
      if (endpoint === 'layers') {
        return { ok: true, value: { source: { fixture: 'workspace' }, error: undefined } }
      }
      return { ok: true, value: { status: { servers: [] }, catalog: { servers: [] } } }
    },
  })

  const unmount = controller.mount()
  await controller.loadLayers()
  assert.ok(endpoints.includes('layers'))
  assert.deepEqual(controller.getSnapshot().layers, {
    source: { fixture: 'workspace' },
    error: undefined,
  })

  await controller.deleteServer('fixture')
  assert.ok(endpoints.filter((endpoint) => endpoint === 'layers').length >= 2)
  assert.deepEqual(controller.getSnapshot().layers, {
    source: { fixture: 'workspace' },
    error: undefined,
  })

  unmount()
  await controller.dispose()
})

test('controller writes through the current namespace revision and folds the answer', async () => {
  const listeners = new Set()
  let scopeSnapshot = {
    status: 'ready',
    value: { mcpServers: {} },
    base: undefined,
    user: {},
    revision: 7,
    writable: true,
    mode: 'host',
  }
  let describeSnapshot = {
    status: 'ready',
    view: { writable: true, hasDocument: true, namespaces: [] },
    error: null,
  }
  const writes = []
  const scope = {
    getSnapshot: () => scopeSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const describe = {
    getSnapshot: () => describeSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async ensure() {},
    acceptView(view) {
      scopeSnapshot = {
        ...scopeSnapshot,
        value: view.value,
        revision: view.revision,
      }
      describeSnapshot = {
        ...describeSnapshot,
        view: { ...describeSnapshot.view, namespaces: [view] },
      }
      for (const listener of listeners) listener()
    },
  }
  const settingsApi = {
    async update(payload) {
      writes.push(['update', payload])
      return {
        result: {
          ok: true,
          value: {
            ns: 'mcp',
            schema: {},
            value: payload.patch,
            applies: 'live',
            secrets: [],
            revision: payload.expectedRevision + 1,
          },
        },
      }
    },
  }
  const controller = new McpSettingsController({
    scope,
    describe,
    settingsApi,
    rpc: async () => ({
      ok: true,
      value: { status: { servers: [] }, catalog: { servers: [] } },
    }),
  })

  assert.equal(
    await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] }),
    true,
  )
  assert.equal(writes[0][0], 'update')
  assert.equal(writes[0][1].expectedRevision, 7)
  assert.equal(writes[0][1].patch.mcpServers.fixture.command, 'node')
  assert.equal(controller.getSnapshot().settings.revision, 8)
  assert.equal(
    await controller.importJson(JSON.stringify({
      mcpServers: { remote: { url: 'https://example.test/mcp' } },
    })),
    true,
  )
  assert.equal(writes[1][0], 'update')
  assert.equal(writes[1][1].expectedRevision, 8)
  assert.equal(writes[1][1].patch.mcpServers.remote.url, 'https://example.test/mcp')
  await controller.dispose()
})
