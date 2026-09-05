import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import esbuild from 'esbuild'

import { normalizeServerConfig } from '../src/client/settings-controller.js'

const projectRoot = new URL('..', import.meta.url)

// The client bundle targets the browser, so the apply-level test compiles
// src/client/index.jsx with esbuild (the same compiler build.mjs uses) and
// evaluates it in Node against a fake document. React is aliased to a stub:
// the Settings page renders far away from module application, so the hooks
// must never run here — a call means the page mounted, which this test never
// does.
const REACT_STUB = `
const miss = (name) => () => {
  throw new Error('react stub: ' + name + ' must not run during apply()')
}
const handler = { get: (_target, prop) => miss(String(prop)) }
export default new Proxy({}, handler)
export const useState = miss('useState')
export const useEffect = miss('useEffect')
export const useMemo = miss('useMemo')
export const useSyncExternalStore = miss('useSyncExternalStore')
`

function fakeDocument() {
  return {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }
}

function snapshotStore(value, revision) {
  return {
    snapshot: { status: 'ready', value, revision, writable: true },
    listeners: new Set(),
    getSnapshot() {
      return this.snapshot
    },
    subscribe(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  }
}

function fakeDescribe() {
  return {
    snapshot: { status: 'ready', view: { namespaces: [] }, error: null },
    listeners: new Set(),
    getSnapshot() {
      return this.snapshot
    },
    subscribe(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    async ensure() {},
    acceptView(view) {
      this.snapshot = { ...this.snapshot, view }
    },
  }
}

/**
 * A fake client context in the shape of one harness generation.
 *
 * 0.1.2-rc.1 provides the `remote` service whose `settings` face takes
 * positional arguments and answers a flat `{ ok, value }` envelope; the
 * `connection` service lost its `api` face entirely.
 * 0.1.1-rc.2 keeps the settings write surface on `connection.api.settings`
 * with a single request-object argument and a `{ result }` envelope, and
 * has no mounted `remote.settings` face.
 */
function fakeCtx({ generation, scopeRevision = 7, views, calls }) {
  const scope = snapshotStore({ mcpServers: {} }, scopeRevision)
  const describe = fakeDescribe()
  const ctx = {
    disposals: [],
    lastRegistered: undefined,
    effect(setup, name) {
      const dispose = setup()
      if (typeof dispose === 'function') ctx.disposals.push([name, dispose])
      return dispose
    },
    settingsScope: {
      bind: () => scope,
      describe: () => describe,
    },
    slots: {
      inject: (key, register) => {
        register()
      },
      register: (options) => {
        ctx.lastRegistered = options
        return options
      },
    },
    connection: {
      rpc: {
        call: async () => ({
          ok: true,
          value: { status: { servers: [] }, catalog: { servers: [] } },
        }),
      },
    },
  }
  if (generation === '0.1.2-rc.1') {
    ctx.remote = {
      settings: {
        async update(ns, patch, expectedRevision) {
          calls.push(['remote.update', ns, patch, expectedRevision])
          return views.update(ns, patch, expectedRevision)
        },
        async mutate(ns, ops, expectedRevision) {
          calls.push(['remote.mutate', ns, ops, expectedRevision])
          return views.mutate(ns, ops, expectedRevision)
        },
      },
    }
  } else {
    ctx.connection.api = {
      settings: {
        async update(request) {
          calls.push(['api.update', request])
          return { result: await views.update(request.ns, request.patch, request.expectedRevision) }
        },
        async mutate(request) {
          calls.push(['api.mutate', request])
          return { result: await views.mutate(request.ns, request.ops, request.expectedRevision) }
        },
      },
    }
  }
  return { ctx, scope, describe }
}

function okView(ns, value, expectedRevision) {
  return {
    ok: true,
    value: {
      ns,
      schema: {},
      value,
      applies: 'live',
      secrets: [],
      revision: expectedRevision + 1,
    },
  }
}

async function loadClientModule() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-adapter-apply-'))
  try {
    const stub = join(dir, 'react-stub.mjs')
    await writeFile(stub, REACT_STUB)
    const built = await esbuild.build({
      entryPoints: [join(projectRoot.pathname, 'src/client/index.jsx')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      jsx: 'transform',
      alias: { react: stub },
      write: false,
      logLevel: 'silent',
    })
    const modulePath = join(dir, 'client-under-test.mjs')
    await writeFile(modulePath, built.outputFiles[0].text)
    return await import(pathToFileURL(modulePath))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function applyWithFakeDocument(ctx, mod) {
  globalThis.document = fakeDocument()
  try {
    return mod.apply(ctx)
  } finally {
    delete globalThis.document
  }
}

test('client inject declares every service it reads, including remote', async () => {
  const mod = await loadClientModule()
  assert.deepEqual(
    [...mod.inject].sort(),
    ['connection', 'remote', 'settingsScope', 'slots'],
  )
})

test('apply wires the 0.1.2-rc.1 remote settings face with positional writes', async () => {
  const mod = await loadClientModule()
  const calls = []
  const { ctx, describe } = fakeCtx({
    generation: '0.1.2-rc.1',
    calls,
    views: {
      update: (ns, patch, expectedRevision) => okView(ns, patch, expectedRevision),
      mutate: (ns, ops, expectedRevision) => okView(ns, {}, expectedRevision),
    },
  })
  await applyWithFakeDocument(ctx, mod)

  const controller = ctx.lastRegistered.inject().controller
  const added = await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] })
  assert.equal(added, true)
  assert.deepEqual(calls, [[
    'remote.update',
    'mcp',
    {
      mcpServers: {
        fixture: normalizeServerConfig('fixture', { command: 'node', args: ['server.mjs'] }),
      },
    },
    7,
  ]])
  // The write answer folds back into the describe mirror and the revision.
  assert.equal(describe.getSnapshot().view.revision, 8)
  await controller.dispose()
})

test('apply falls back to connection.api.settings on 0.1.1-rc.2', async () => {
  const mod = await loadClientModule()
  const calls = []
  const { ctx, describe } = fakeCtx({
    generation: '0.1.1-rc.2',
    calls,
    views: {
      update: (ns, patch, expectedRevision) => okView(ns, patch, expectedRevision),
      mutate: (ns, ops, expectedRevision) => okView(ns, {}, expectedRevision),
    },
  })
  await applyWithFakeDocument(ctx, mod)

  const controller = ctx.lastRegistered.inject().controller
  const added = await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] })
  assert.equal(added, true)
  assert.equal(calls[0][0], 'api.update')
  assert.equal(calls[0][1].ns, 'mcp')
  assert.equal(calls[0][1].expectedRevision, 7)
  assert.equal(describe.getSnapshot().view.revision, 8)
  await controller.dispose()
})

test('apply reports a failed remote write through the controller error', async () => {
  const mod = await loadClientModule()
  const { ctx } = fakeCtx({
    generation: '0.1.2-rc.1',
    calls: [],
    views: {
      update: () => ({ ok: false, error: { code: 'conflict', message: 'revision moved' } }),
      mutate: () => ({ ok: false, error: { code: 'conflict', message: 'revision moved' } }),
    },
  })
  await applyWithFakeDocument(ctx, mod)

  const controller = ctx.lastRegistered.inject().controller
  const added = await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] })
  assert.equal(added, false)
  assert.match(controller.getSnapshot().error, /revision moved/)
  await controller.dispose()
})

test('apply fails with guidance when no settings write face exists', async () => {
  const mod = await loadClientModule()
  const { ctx } = fakeCtx({ generation: '0.1.1-rc.2', calls: [], views: {} })
  delete ctx.connection.api
  // apply is synchronous: a missing write face throws before the loader ever
  // receives a plugin handle.
  assert.throws(() => mod.apply(ctx), /settings write API/)
})
