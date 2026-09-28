import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

import { MCP_RPC_ENDPOINTS, MCP_RPC_ROUTE_PREFIX, installMcpManagerRpc } from '../src/host/manager.js'

// Faithful model of the DSH host-side connection service (copied from
// @deepseek-ai/dsh-client-connection's HostConnectionService.registerFetchRoute
// semantics): exact Fetch routes land in one live map, each registration is an
// effect on the PROVIDER fiber, and calling the returned disposer removes the
// route. The point this test pins (ADR 0011): the Adapter's RPC surface
// registers through `connection.fetch.register` inside a plugin fiber that
// never declares `webServer`, survives a dispose/remount cycle without a
// duplicate-registration collision, and serves the connection envelope — the
// properties the old `connection.rpc.handle` mount silently lost on cordis 4.
class FakeConnectionService extends Service {
  fetchRoutes = new Map()

  constructor(ctx) {
    super(ctx, 'connection')
  }

  get fetch() {
    const owner = this.ctx
    return { register: (route) => this.registerFetchRoute(owner, route) }
  }

  registerFetchRoute(owner, route) {
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, route)
      return () => {
        this.fetchRoutes.delete(route.path)
      }
    }, `client-connection: ${route.path} Fetch route`)
  }
}

function fakeManager() {
  return {
    statusSnapshot: () => ({ servers: [{ name: 'demo', state: 'connected', toolCount: 1 }] }),
    catalogSnapshot: () => ({ servers: [] }),
    async disconnect() {},
    async listTools() {},
  }
}

async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return true
}

function mountAdapterRpc(ctx) {
  return ctx.plugin({
    name: 'mcp-adapter-rpc-under-test',
    apply(pluginCtx) {
      pluginCtx.inject(['connection'], (rpcCtx) => {
        installMcpManagerRpc(rpcCtx, fakeManager())
      })
    },
  })
}

test('the RPC surface mounts as exact Fetch routes through a real cordis fiber', async () => {
  const ctx = new Context()
  let connection
  ctx.plugin({
    name: 'fake-connection',
    // Capture the instance without returning it: a returned Service counts
    // as a provided implementation and cordis rejects it as an invalid effect.
    apply(connectionCtx) {
      connection = new FakeConnectionService(connectionCtx)
    },
  })
  const fiber = mountAdapterRpc(ctx)
  await ctx.provide()

  assert.equal(
    await waitFor(() => connection.fetchRoutes.size === MCP_RPC_ENDPOINTS.length),
    true,
    `all routes registered, got: ${JSON.stringify([...connection.fetchRoutes.keys()])}`,
  )
  assert.deepEqual(
    [...connection.fetchRoutes.keys()],
    MCP_RPC_ENDPOINTS.map((endpoint) => `${MCP_RPC_ROUTE_PREFIX}${endpoint}`),
  )

  const route = connection.fetchRoutes.get(`${MCP_RPC_ROUTE_PREFIX}status`)
  const response = await route.fetch(
    new Request(`http://mcp.test${route.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'rpc-7',
        method: 'mcp-adapter/status',
        payload: {},
      }),
    }),
  )
  const envelope = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(envelope, {
    type: 'server-response',
    rpcId: 'rpc-7',
    result: { ok: true, value: { servers: [{ name: 'demo', state: 'connected', toolCount: 1 }] } },
  })

  // Entry restart shape: the plugin fiber disposes (the RPC fiber with it),
  // every route goes, and a fresh activation re-registers without colliding
  // with a stale registration.
  await fiber.dispose()
  assert.equal(await waitFor(() => connection.fetchRoutes.size === 0), true)
  const second = mountAdapterRpc(ctx)
  assert.equal(await waitFor(() => connection.fetchRoutes.size === MCP_RPC_ENDPOINTS.length), true)
  await second.dispose()
})
