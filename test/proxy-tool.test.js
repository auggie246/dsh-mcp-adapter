import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { McpClientManager } from '../src/host/manager.js'
import { createMcpProxyTool } from '../src/host/proxy-tool.js'

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
}

function execution() {
  return {
    name: 'mcp',
    callId: 'call-1',
    signal: new AbortController().signal,
    agent: {
      session: { header: { id: 'session-1' } },
    },
  }
}

function createContext({ approval, spillStore } = {}) {
  const warnings = []
  return {
    warnings,
    logger: { warn(message) { warnings.push(message) } },
    get(name) {
      if (name === 'approval') return approval
      if (name === 'spillStore') return spillStore
      return undefined
    },
  }
}

class FakeManager {
  constructor({
    name = 'github',
    config = serverConfig(),
    tools = [{ name: 'list_issues', description: 'List issues', inputSchema: { type: 'object' } }],
    result = { content: [{ type: 'text', text: 'done' }] },
    listError,
  } = {}) {
    this.name = name
    this.config = config
    this.tools = tools
    this.result = result
    this.listError = listError
    this.callCount = 0
    this.listCount = 0
  }

  getServerConfig(name) {
    return name === this.name ? structuredClone(this.config) : undefined
  }

  catalogSnapshot() {
    return {
      servers: [{
        name: this.name,
        disabled: this.config.disabled,
        state: 'disconnected',
        tools: structuredClone(this.tools),
      }],
    }
  }

  async listTools(name) {
    this.listCount += 1
    if (name !== this.name) throw new Error(`Unknown MCP server ${name}`)
    if (this.listError !== undefined) throw this.listError
    return structuredClone(this.tools)
  }

  async callTool(name, tool, args) {
    this.callCount += 1
    this.lastCall = { name, tool, args }
    return structuredClone(this.result)
  }
}

test('mcp alone discovers, describes, approves, and calls a stdio fixture', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url))
  const manager = new McpClientManager(
    new MemoryScope({
      mcpServers: { fixture: serverConfig({ args: [fixture] }) },
    }),
    { schedule: () => () => {} },
  )
  const approvalRequests = []
  const ctx = createContext({
    approval: {
      async request(request) {
        approvalRequests.push(request)
        return 'allowed-once'
      },
    },
  })
  const tool = createMcpProxyTool(ctx, manager)
  const exec = execution()

  const search = await tool.execute({ action: 'search', query: 'ping' }, exec)
  assert.deepEqual(search.data.results.map((result) => result.name), ['fixture__ping'])

  const describe = await tool.execute(
    { action: 'describe', server: 'fixture', tool: 'fixture__ping' },
    exec,
  )
  assert.equal(describe.data.inputSchema.type, 'object')

  const call = await tool.execute(
    {
      action: 'call',
      server: 'fixture',
      tool: 'ping',
      args: { token: 'must-not-appear' },
    },
    exec,
  )
  assert.equal(call.text, 'pong')
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /fixture.*ping/)
  assert.match(approvalRequests[0].reason, /\[redacted\]/)
  assert.doesNotMatch(approvalRequests[0].reason, /must-not-appear/)

  await manager.dispose()
})

test('autoAllow skips approval and rejection blocks the remote call', async () => {
  const autoManager = new FakeManager({ config: serverConfig({ autoAllow: true }) })
  const autoTool = createMcpProxyTool(
    createContext({ approval: { request() { throw new Error('must not ask') } } }),
    autoManager,
  )
  const allowed = await autoTool.execute(
    { action: 'call', server: 'github', tool: 'list_issues', args: {} },
    execution(),
  )
  assert.equal(allowed.text, 'done')
  assert.equal(autoManager.callCount, 1)

  const gatedManager = new FakeManager()
  const gatedTool = createMcpProxyTool(
    createContext({ approval: { async request() { return 'rejected' } } }),
    gatedManager,
  )
  await assert.rejects(
    gatedTool.execute(
      { action: 'call', server: 'github', tool: 'list_issues', args: {} },
      execution(),
    ),
    /not approved \(rejected\)/,
  )
  assert.equal(gatedManager.callCount, 0)
})

test('unknown names return suggestions and transport failures return setup hints', async () => {
  const manager = new FakeManager()
  const tool = createMcpProxyTool(createContext(), manager)

  await assert.rejects(
    tool.execute(
      { action: 'describe', server: 'gitub', tool: 'list_issues' },
      execution(),
    ),
    /Did you mean: github/,
  )
  await assert.rejects(
    tool.execute(
      { action: 'describe', server: 'github', tool: 'list_issue' },
      execution(),
    ),
    /Did you mean: list_issues/,
  )

  const broken = new FakeManager({ listError: new Error('spawn ENOENT') })
  const brokenTool = createMcpProxyTool(createContext(), broken)
  await assert.rejects(
    brokenTool.execute(
      { action: 'describe', server: 'github', tool: 'list_issues' },
      execution(),
    ),
    /Setup hint: check command.*executable path.*Settings > MCP/,
  )
})

test('large call output is bounded and spills full text and raw result', async () => {
  const text = `${'large line\n'.repeat(6_000)}tail`
  const manager = new FakeManager({
    config: serverConfig({ autoAllow: true }),
    result: {
      content: [{ type: 'text', text }],
      structuredContent: { rows: Array.from({ length: 3_000 }, (_, index) => ({ index })) },
    },
  })
  const saves = []
  const spillStore = {
    async saveText(input) {
      saves.push(input)
      return {
        locator: `spill://${input.source.label}`,
        bytes: Buffer.byteLength(input.content),
        retrievalHint: 'Use read or grep.',
      }
    },
  }
  const tool = createMcpProxyTool(createContext({ spillStore }), manager)

  const result = await tool.execute(
    { action: 'call', server: 'github', tool: 'list_issues', args: {} },
    execution(),
  )

  assert.equal(result.guard.textTruncated, true)
  assert.equal(result.guard.resultSummarized, true)
  assert.ok(Buffer.byteLength(result.text) <= 50 * 1024)
  assert.match(result.text, /Full text stored at: spill:\/\/mcp-output/)
  assert.equal(result.data.omitted, true)
  assert.equal(result.data.fullResult.locator, 'spill://mcp-result')
  assert.deepEqual(
    saves.map((save) => save.source.label).sort(),
    ['mcp-output', 'mcp-result'],
  )
})
