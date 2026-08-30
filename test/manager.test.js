import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  MCP_RPC_CHANNEL,
  McpClientManager,
  installMcpManagerRpc,
} from '../src/host/manager.js'
import { createMcpConnection } from '../src/host/mcp-connection.js'

function serverConfig(overrides = {}) {
  return {
    command: process.execPath,
    args: [],
    env: {},
    headers: {},
    disabled: false,
    autoAllow: false,
    lifecycle: 'lazy',
    idleTimeoutMinutes: 10,
    promotedTools: [],
    ...overrides,
  }
}

class MemoryScope {
  constructor(value) {
    this.value = structuredClone(value)
    this.watchers = new Set()
  }

  get() {
    return structuredClone(this.value)
  }

  watch(callback) {
    this.watchers.add(callback)
    return () => this.watchers.delete(callback)
  }

  async replace(value) {
    const previous = this.value
    this.value = structuredClone(value)
    for (const callback of this.watchers) {
      await callback(structuredClone(this.value), structuredClone(previous))
    }
  }
}

class ManualScheduler {
  tasks = []

  schedule(callback, delay) {
    const task = { callback, delay, active: true }
    this.tasks.push(task)
    return () => {
      task.active = false
    }
  }

  async runNext() {
    const task = this.tasks.find((candidate) => candidate.active)
    assert.ok(task, 'expected one active scheduled callback')
    task.active = false
    await task.callback()
  }

  active() {
    return this.tasks.filter((task) => task.active)
  }
}

function fakeConnectionFactory(initialTools) {
  const connections = []
  const factory = async (_name, _config, callbacks) => {
    const connection = {
      callbacks,
      closed: false,
      transportType: 'test',
      client: {
        async listTools() {
          return { tools: initialTools }
        },
        async callTool({ name, arguments: args }) {
          return { content: [{ type: 'text', text: `${name}:${args.value}` }] }
        },
      },
      async close() {
        connection.closed = true
        callbacks.onClose?.()
      },
    }
    connections.push(connection)
    return connection
  }
  return { factory, connections }
}

test('stdio Server stays lazy, caches tools, idles, and reconnects', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url))
  const scope = new MemoryScope({
    mcpServers: {
      fixture: serverConfig({ args: [fixture] }),
    },
  })
  const scheduler = new ManualScheduler()
  let connectionCount = 0
  const manager = new McpClientManager(scope, {
    schedule: scheduler.schedule.bind(scheduler),
    connectionFactory: async (...args) => {
      connectionCount += 1
      return createMcpConnection(...args)
    },
  })

  assert.deepEqual(manager.statusSnapshot(), {
    servers: [{ name: 'fixture', state: 'disconnected', toolCount: 0 }],
  })
  assert.equal(connectionCount, 0)

  const tools = await manager.listTools('fixture')
  assert.equal(connectionCount, 1)
  assert.deepEqual(tools.map((tool) => tool.name), ['ping'])
  assert.equal(manager.statusSnapshot().servers[0].state, 'connected')
  assert.equal(scheduler.active()[0].delay, 600_000)

  const result = await manager.callTool('fixture', 'ping')
  assert.deepEqual(result.content, [{ type: 'text', text: 'pong' }])
  assert.deepEqual(manager.getCachedTools('fixture').map((tool) => tool.name), ['ping'])

  await scheduler.runNext()
  assert.equal(manager.statusSnapshot().servers[0].state, 'disconnected')

  await manager.listTools('fixture')
  assert.equal(connectionCount, 2)
  assert.equal(manager.statusSnapshot().servers[0].state, 'connected')

  await manager.dispose()
})

test('tool lists refresh, presentation edits stay live, and transport edits reconnect', async () => {
  const firstTool = {
    name: 'alpha',
    description: 'First tool',
    inputSchema: { type: 'object' },
  }
  const scope = new MemoryScope({
    mcpServers: { demo: serverConfig() },
  })
  const scheduler = new ManualScheduler()
  const fake = fakeConnectionFactory([firstTool])
  const manager = new McpClientManager(scope, {
    schedule: scheduler.schedule.bind(scheduler),
    connectionFactory: fake.factory,
  })

  await manager.listTools('demo')
  assert.deepEqual(manager.getCachedTools('demo'), [firstTool])

  const replacementTool = {
    name: 'beta',
    description: 'Replacement tool',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  }
  fake.connections[0].callbacks.onToolsChanged(null, [replacementTool])
  assert.deepEqual(manager.getCachedTools('demo'), [replacementTool])

  await scope.replace({
    mcpServers: { demo: serverConfig({ autoAllow: true, promotedTools: ['beta'] }) },
  })
  assert.equal(fake.connections[0].closed, false)
  assert.deepEqual(manager.getCachedTools('demo'), [replacementTool])
  assert.equal(manager.statusSnapshot().servers[0].state, 'connected')

  await scope.replace({
    mcpServers: { demo: serverConfig({ args: ['changed'], autoAllow: true }) },
  })
  assert.equal(fake.connections[0].closed, true)
  assert.deepEqual(manager.getCachedTools('demo'), [])
  assert.equal(manager.statusSnapshot().servers[0].state, 'disconnected')

  await manager.listTools('demo')
  assert.equal(fake.connections.length, 2)

  await scope.replace({
    mcpServers: { demo: serverConfig({ disabled: true }) },
  })
  assert.equal(fake.connections[1].closed, true)
  assert.equal(manager.statusSnapshot().servers[0].state, 'disabled')
  await assert.rejects(manager.listTools('demo'), /is disabled/)

  await scope.replace({
    mcpServers: { demo: serverConfig({ disabled: false }) },
  })
  assert.equal(manager.statusSnapshot().servers[0].state, 'disconnected')
  assert.equal(fake.connections.length, 2)
  await manager.listTools('demo')
  assert.equal(fake.connections.length, 3)

  await scope.replace({ mcpServers: {} })
  assert.deepEqual(manager.statusSnapshot(), { servers: [] })

  await manager.dispose()
})

test('caller cancellation does not abort a shared connection', async () => {
  const scope = new MemoryScope({ mcpServers: { demo: serverConfig() } })
  const scheduler = new ManualScheduler()
  let resolveConnection
  let connectionCount = 0
  const manager = new McpClientManager(scope, {
    schedule: scheduler.schedule.bind(scheduler),
    connectionFactory: () => {
      connectionCount += 1
      return new Promise((resolve) => { resolveConnection = resolve })
    },
  })
  const controller = new AbortController()
  const first = manager.listTools('demo', { signal: controller.signal })
  const second = manager.listTools('demo')

  controller.abort(new Error('first caller cancelled'))
  await assert.rejects(first, /first caller cancelled/)
  resolveConnection({
    transportType: 'test',
    client: { async listTools() { return { tools: [{ name: 'shared', inputSchema: { type: 'object' } }] } } },
    async close() {},
  })

  assert.deepEqual((await second).map((tool) => tool.name), ['shared'])
  assert.equal(connectionCount, 1)
  await manager.dispose()
})

test('dispose waits for an in-flight connection and closes its late result', async () => {
  const scope = new MemoryScope({ mcpServers: { demo: serverConfig() } })
  const scheduler = new ManualScheduler()
  let resolveConnection
  const connection = {
    transportType: 'test',
    client: { async listTools() { return { tools: [] } } },
    closed: false,
    async close() { this.closed = true },
  }
  const manager = new McpClientManager(scope, {
    schedule: scheduler.schedule.bind(scheduler),
    connectionFactory: () => new Promise((resolve) => { resolveConnection = resolve }),
  })

  const listing = manager.listTools('demo')
  const listingRejected = assert.rejects(listing, /changed while connecting/)
  let disposalFinished = false
  const disposal = manager.dispose().then(() => { disposalFinished = true })
  await Promise.resolve()
  assert.equal(disposalFinished, false)

  resolveConnection(connection)
  await listingRejected
  await disposal
  assert.equal(connection.closed, true)
})

test('Connection RPC exposes detached status and catalog snapshots', async () => {
  let registration
  const manager = {
    statusSnapshot: () => ({ servers: [{ name: 'demo', state: 'connected', toolCount: 1 }] }),
    catalogSnapshot: () => ({ servers: [{ name: 'demo', tools: [{ name: 'ping' }] }] }),
  }
  const ctx = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          registration = { channel, handler, options }
        },
      },
    },
  }

  installMcpManagerRpc(ctx, manager)
  assert.equal(registration.channel, MCP_RPC_CHANNEL)
  assert.deepEqual(registration.options, { authority: 'trusted-host' })
  assert.deepEqual(await registration.handler('status'), {
    ok: true,
    value: { servers: [{ name: 'demo', state: 'connected', toolCount: 1 }] },
  })
  assert.deepEqual(await registration.handler('catalog'), {
    ok: true,
    value: { servers: [{ name: 'demo', tools: [{ name: 'ping' }] }] },
  })
  assert.equal((await registration.handler('missing')).ok, false)
})

test('callTool delegates arguments and returns detached JSON', async () => {
  const scope = new MemoryScope({ mcpServers: { demo: serverConfig() } })
  const scheduler = new ManualScheduler()
  const fake = fakeConnectionFactory([])
  const manager = new McpClientManager(scope, {
    schedule: scheduler.schedule.bind(scheduler),
    connectionFactory: fake.factory,
  })

  const result = await manager.callTool('demo', 'echo', { value: 'hello' })
  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'echo:hello' }],
  })

  await manager.dispose()
})
