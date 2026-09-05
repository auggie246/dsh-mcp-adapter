import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const projectRoot = new URL('..', import.meta.url)

test('npm package contains both Adapter faces and only publishable support files', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'dsh-mcp-adapter-npm-'))

  try {
    await rm(new URL('../lib', import.meta.url), { recursive: true, force: true })
    const result = spawnSync(
      'npm',
      ['pack', '--dry-run', '--json', '--cache', cache],
      { cwd: projectRoot, encoding: 'utf8' },
    )

    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    // npm < 11 returns an array of pack results; npm >= 12 returns an object
    // keyed by package name.
    const pack = Array.isArray(parsed)
      ? parsed[0]
      : parsed['@auggieteo/dsh-mcp-adapter']
    assert.equal(pack.name, '@auggieteo/dsh-mcp-adapter')

    const files = pack.files.map(({ path }) => path)
    assert.ok(files.includes('src/host/index.js'))
    assert.ok(files.includes('lib/client.js'))
    assert.ok(files.includes('lib/client.js.map'))
    assert.ok(files.includes('cordis.patch.yml'))
    assert.ok(files.includes('README.md'))
    assert.ok(!files.some((path) => path.startsWith('src/client/')))
    assert.ok(!files.some((path) => path.startsWith('test/')))
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
})
