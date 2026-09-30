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

/** One configForms entry controller, in the 0.1.7 snapshot shape. */
function fakeForm(value, revision) {
  return {
    snapshot: {
      status: 'ready',
      value,
      base: undefined,
      user: {},
      revision,
      writable: true,
      mode: 'host',
    },
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
    snapshot: {
      status: 'ready',
      view: { writable: true, hasDocument: true, namespaces: [] },
      error: null,
    },
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
      const namespaces = this.snapshot.view.namespaces
      this.snapshot = {
        ...this.snapshot,
        view: {
          ...this.snapshot.view,
          namespaces: namespaces.some((row) => row.ns === view.ns)
            ? namespaces.map((row) => (row.ns === view.ns ? view : row))
            : [...namespaces, view],
        },
      }
    },
  }
}

/**
 * A fake client context in the DSH 0.1.7 shape.
 *
 * Reads and the write queue live behind the `configForms` service:
 * `get(entryId)` answers the per-entry form controller and `describe()` the
 * shared document mirror. The write face is the `remote` service's
 * `settings` namespace: a traced dotted service with positional arguments
 * and a flat `{ ok, value }` envelope — reading it through
 * `ctx.remote.settings` throws the runner's governance error, and only the
 * inject-free `ctx.get('remote.settings')` reaches it.
 */
function fakeCtx({ scopeRevision = 7, views, calls }) {
  const form = fakeForm({ mcpServers: {} }, scopeRevision)
  const describe = fakeDescribe()
  const settingsFace = {
    async update(ns, patch, expectedRevision) {
      calls.push(['remote.update', ns, patch, expectedRevision])
      return views.update(ns, patch, expectedRevision)
    },
    async mutate(ns, ops, expectedRevision) {
      calls.push(['remote.mutate', ns, ops, expectedRevision])
      return views.mutate(ns, ops, expectedRevision)
    },
  }
  const ctx = {
    disposals: [],
    lastRegistered: undefined,
    effect(setup, name) {
      const dispose = setup()
      if (typeof dispose === 'function') ctx.disposals.push([name, dispose])
      return dispose
    },
    configForms: {
      get: (entryId) => {
        calls.push(['configForms.get', entryId])
        return form
      },
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
  // The transport service is bare: the namespace lives only behind the
  // mount, and the governed dotted access throws exactly like the runner.
  ctx.remote = {}
  Object.defineProperty(ctx.remote, 'settings', {
    get() {
      throw new Error('cannot get property "remote.settings" without inject')
    },
  })
  ctx.get = (name) => (name === 'remote.settings' ? settingsFace : undefined)
  return { ctx, form, describe }
}

function okView(ns, value, expectedRevision) {
  return {
    ok: true,
    value: {
      ns,
      autoGenerate: true,
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

test('client inject declares every service it reads, including configForms and remote', async () => {
  const mod = await loadClientModule()
  assert.deepEqual(
    [...mod.inject].sort(),
    ['configForms', 'connection', 'remote', 'slots'],
  )
})

test('client inject omits remote.settings: it is governed and optional per profile', async () => {
  // Declaring the dotted service would park the plugin fiber on a profile
  // that never mounts the remotes bundle; the mounted namespace is reached
  // through the inject-free `ctx.get` read instead.
  const mod = await loadClientModule()
  assert.equal(mod.inject.includes('remote.settings'), false)
})

test('apply reads the entry form from configForms under the Loader entry id', async () => {
  const mod = await loadClientModule()
  const calls = []
  const { ctx } = fakeCtx({
    calls,
    views: {
      update: (ns, patch, expectedRevision) => okView(ns, patch, expectedRevision),
      mutate: (ns, ops, expectedRevision) => okView(ns, {}, expectedRevision),
    },
  })
  await applyWithFakeDocument(ctx, mod)

  assert.deepEqual(calls[0], ['configForms.get', 'mcp-adapter'])
  const controller = ctx.lastRegistered.inject().controller
  const added = await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] })
  assert.equal(added, true)
  await controller.dispose()
})

test('apply resolves the mounted remote.settings namespace through ctx.get', async () => {
  const mod = await loadClientModule()
  const calls = []
  const { ctx } = fakeCtx({
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
  assert.equal(calls.some(([method]) => method === 'remote.update'), true)
  await controller.dispose()
})

test('apply still resolves a plain remote.settings property face (test-double shape)', async () => {
  const mod = await loadClientModule()
  const calls = []
  const views = {
    update: (ns, patch, expectedRevision) => okView(ns, patch, expectedRevision),
    mutate: (ns, ops, expectedRevision) => okView(ns, {}, expectedRevision),
  }
  const { ctx } = fakeCtx({ calls, views })
  // A runner (or test double) that exposes the face as a plain property and
  // offers no inject-free `ctx.get` must still resolve through the direct read.
  delete ctx.get
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
  await applyWithFakeDocument(ctx, mod)

  const controller = ctx.lastRegistered.inject().controller
  const added = await controller.addServer('fixture', { command: 'node', args: ['server.mjs'] })
  assert.equal(added, true)
  assert.equal(calls.at(-1)[0], 'remote.update')
  await controller.dispose()
})

test('apply wires the remote settings face with positional writes on the entry id', async () => {
  const mod = await loadClientModule()
  const calls = []
  const { ctx, describe } = fakeCtx({
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
  assert.deepEqual(
    calls.filter(([method]) => method.startsWith('remote.')),
    [[
      'remote.update',
      'mcp-adapter',
      {
        mcpServers: {
          fixture: normalizeServerConfig('fixture', { command: 'node', args: ['server.mjs'] }),
        },
      },
      7,
    ]],
  )
  // The write answer folds back into the describe mirror and the revision.
  const row = describe
    .getSnapshot()
    .view.namespaces
    .find((entry) => entry.ns === 'mcp-adapter')
  assert.equal(row.revision, 8)
  await controller.dispose()
})

test('apply reports a failed remote write through the controller error', async () => {
  const mod = await loadClientModule()
  const { ctx } = fakeCtx({
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
  const { ctx } = fakeCtx({ calls: [], views: {} })
  delete ctx.get
  ctx.remote = {}
  // apply is synchronous: a missing write face throws before the loader ever
  // receives a plugin handle.
  assert.throws(() => mod.apply(ctx), /settings write API/)
})

test('apply wires the 0.2.0-rc.2 remote settings face identically', async () => {
  // DSH 0.2.0-rc.2 mounts the same client surface as 0.1.7 — the `configForms`
  // service, the governed dotted `remote.settings` namespace, positional write
  // arguments, and the flat `{ ok, value }` envelope — verified against the
  // installed 0.2.0-rc.2 packages. This case pins that generation by execution
  // (ADR 0009): the peer range widens because the suite proves the shape, not
  // because a diff looked unchanged. Any drift in the mount shape fails here.
  const mod = await loadClientModule()
  const calls = []
  const { ctx, describe } = fakeCtx({
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
  assert.deepEqual(
    calls.filter(([method]) => method.startsWith('remote.')),
    [[
      'remote.update',
      'mcp-adapter',
      {
        mcpServers: {
          fixture: normalizeServerConfig('fixture', { command: 'node', args: ['server.mjs'] }),
        },
      },
      7,
    ]],
  )
  const row = describe
    .getSnapshot()
    .view.namespaces
    .find((entry) => entry.ns === 'mcp-adapter')
  assert.equal(row.revision, 8)
  await controller.dispose()
})
