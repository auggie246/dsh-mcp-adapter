import assert from 'node:assert/strict'
import test from 'node:test'

import { importLegacyMcpSettings } from '../src/host/legacy-import.js'

const LEGACY_YAML = `ui:
  theme: dark
mcp:
  mcpServers:
    demo:
      command: node
      args:
        - server.mjs
  skillInstall: runtime
`

function defaults() {
  return { mcpServers: {}, skillInstall: 'file' }
}

function fakeEnv({
  files = { '/profile/settings.yaml.imported': LEGACY_YAML },
  row = { ns: 'mcp-adapter', value: defaults(), revision: 0 },
  withSettings = true,
} = {}) {
  const updates = []
  const writes = new Map()
  const logs = { info: [], warn: [] }
  const settings = {
    describe: () => (row === undefined ? [] : [row]),
    update: async (ns, patch) => {
      updates.push([ns, patch])
    },
  }
  const ctx = {
    logger: {
      info: (message, ...args) => logs.info.push([message, ...args]),
      warn: (message, ...args) => logs.warn.push([message, ...args]),
    },
    get: (name) => {
      if (name === 'settings') return withSettings ? settings : undefined
      if (name === 'profileContext') return { home: '/profile' }
      return undefined
    },
  }
  const deps = {
    ...(withSettings ? { settings } : {}),
    profileContext: { home: '/profile' },
    logger: ctx.logger,
    readFile: async (path) => {
      if (!Object.hasOwn(files, path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return files[path]
    },
    writeFile: async (path, text) => {
      writes.set(path, text)
    },
  }
  return { ctx, deps, updates, writes, logs, files }
}

test('imports the untouched entry once and records a marker', async () => {
  const { ctx, deps, updates, writes, logs } = fakeEnv()

  await importLegacyMcpSettings(ctx, deps)

  assert.deepEqual(updates, [[
    'mcp-adapter',
    {
      mcpServers: { demo: { command: 'node', args: ['server.mjs'] } },
      skillInstall: 'runtime',
    },
  ]])
  assert.equal(
    writes.has('/profile/mcp-adapter.legacy-imported'),
    true,
    'a marker prevents a later re-import',
  )
  assert.equal(logs.warn.length, 0)
  assert.equal(logs.info.length, 1)
})

test('the marker makes a second run a no-op even with the document still present', async () => {
  const { ctx, deps, updates } = fakeEnv({
    files: {
      '/profile/settings.yaml.imported': LEGACY_YAML,
      '/profile/mcp-adapter.legacy-imported': 'done\n',
    },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [])
})

test('leaves the legacy section in place when the entry already has written Config', async () => {
  const { ctx, deps, updates, writes, logs } = fakeEnv({
    row: {
      ns: 'mcp-adapter',
      value: { mcpServers: { mine: { command: 'node' } }, skillInstall: 'file' },
      user: { mcpServers: { mine: { command: 'node' } } },
      revision: 4,
    },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [])
  assert.equal(writes.size, 0)
  assert.match(logs.info.map((entry) => entry.join(' ')).join('\n'), /already has written Config/)
})

test('an entry holding non-default servers is treated as touched', async () => {
  const { ctx, deps, updates } = fakeEnv({
    row: {
      ns: 'mcp-adapter',
      value: { mcpServers: { base: { command: 'node' } }, skillInstall: 'file' },
      revision: 0,
    },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [])
})

test('an invalid legacy section warns, writes nothing, and leaves recovery manual', async () => {
  const { ctx, deps, updates, writes, logs } = fakeEnv({
    files: {
      '/profile/settings.yaml.imported': `mcp:
  mcpServers:
    broken:
      command: node
      url: https://example.test/mcp
`,
    },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [])
  assert.equal(writes.size, 0)
  assert.match(logs.warn.map((entry) => entry.join(' ')).join('\n'), /configure exactly one transport/)
  assert.match(logs.warn.map((entry) => entry.join(' ')).join('\n'), /copy the "mcp" section/)
})

test('a legacy document without an mcp section is ignored', async () => {
  const { ctx, deps, updates } = fakeEnv({
    files: { '/profile/settings.yaml.imported': 'ui:\n  theme: dark\n' },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [])
})

test('reads settings.yaml directly when the platform rename has not happened yet', async () => {
  const { ctx, deps, updates } = fakeEnv({
    files: { '/profile/settings.yaml': LEGACY_YAML },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.equal(updates.length, 1)
})

test('does nothing without the settings service or a profile context', async () => {
  const noSettings = fakeEnv({ withSettings: false })
  await importLegacyMcpSettings(noSettings.ctx, noSettings.deps)
  assert.deepEqual(noSettings.updates, [])

  const bareCtx = { logger: { info: () => {}, warn: () => {} }, get: () => undefined }
  await importLegacyMcpSettings(bareCtx, {
    readFile: async () => {
      throw new Error('must not read')
    },
    writeFile: async () => {},
  })
})

test('unknown fields in the legacy section are dropped, never imported', async () => {
  const { ctx, deps, updates } = fakeEnv({
    files: {
      '/profile/settings.yaml.imported': `mcp:
  mcpServers:
    demo:
      command: node
  retiredFlag: true
`,
    },
  })

  await importLegacyMcpSettings(ctx, deps)
  assert.deepEqual(updates, [[
    'mcp-adapter',
    { mcpServers: { demo: { command: 'node' } } },
  ]])
})
