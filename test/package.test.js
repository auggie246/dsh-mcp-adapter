import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    // npm 10 prints `[pack]`; npm 12 prints `{ "<name>": pack }`.
    const parsed = JSON.parse(result.stdout)
    const pack = (Array.isArray(parsed) ? parsed : Object.values(parsed)).at(0)
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

// The DSH runtime gates every `@deepseek-ai/dsh*` peer range against **its own
// version** (`dsh-app-boot` calls `semver.satisfies(runtimeVersion, range,
// { includePrerelease: true })`), and a range that excludes the running version
// makes the profile skip the whole bundle at startup. The range is therefore a
// tested contract, not packaging decoration.
//
// A full semver implementation is not warranted: the Adapter declares caret
// ranges only, so this evaluator covers that one form — a caret is a lower
// bound with a cap at the next major, and below 1.0 at the next minor.
const CARET_RANGE = /^\^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(text)
  if (match === null) throw new Error(`not a semantic version: ${text}`)
  const [, major, minor, patch, pre] = match
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre === undefined ? [] : pre.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
  }
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  // A prerelease sorts below its own stable release.
  if (a.pre.length === 0 || b.pre.length === 0) {
    if (a.pre.length === b.pre.length) return 0
    return a.pre.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const left = a.pre[index]
    const right = b.pre[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === typeof right) return left < right ? -1 : 1
    // Numeric identifiers sort below alphanumeric ones.
    return typeof left === 'number' ? -1 : 1
  }
  return 0
}

function satisfies(version, range) {
  return range.split('||').some((branch) => {
    const match = CARET_RANGE.exec(branch.trim())
    if (match === null) throw new Error(`unsupported peer range form: ${branch.trim()}`)
    const [, major, minor, patch, pre] = match
    const lower = parseVersion(`${major}.${minor}.${patch}${pre === undefined ? '' : `-${pre}`}`)
    const cap = Number(major) > 0
      ? `${Number(major) + 1}.0.0-0`
      : Number(minor) > 0
        ? `0.${Number(minor) + 1}.0-0`
        : `0.0.${Number(patch) + 1}-0`
    return compareVersions(version, lower) >= 0 && compareVersions(version, parseVersion(cap)) < 0
  })
}

test('the settings peer range accepts every DSH runtime the Adapter supports', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const range = manifest.peerDependencies['@deepseek-ai/dsh-settings']

  // Pinned literally: widening this range is a deliberate act (ADR 0009), and a
  // silent narrowing is what breaks every installed profile on a DSH upgrade.
  assert.equal(range, '^0.1.7-rc.1 || ^0.2.0-rc.1')

  for (const runtime of ['0.1.7-rc.1', '0.1.7-rc.2', '0.1.7', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0']) {
    assert.ok(satisfies(parseVersion(runtime), range), `${runtime} must be accepted by ${range}`)
  }
  // Outside the contract: 0.1.6 predates the entry-Config model (v0.3.x territory),
  // and 0.3.x is unverified, so the cap must stay loud rather than load optimistically.
  for (const runtime of ['0.1.6', '0.1.7-rc.0', '0.2.0-rc.0', '0.3.0-rc.1']) {
    assert.ok(!satisfies(parseVersion(runtime), range), `${runtime} must be rejected by ${range}`)
  }
})
