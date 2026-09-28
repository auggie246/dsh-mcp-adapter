import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  NAV_ICON_MARKER,
  NAV_ICON_SHELL_RELATIVE,
  installMcpNavIconPatch,
  locateNavIconShell,
  navIconDshRoot,
  patchNavIconShell,
  revertNavIconShell,
} from '../src/host/nav-icon.js'

// The navIcon() shape as the 0.1.7 shell build emits it: tab-indented
// sections, the `models` branch the patch pins, and the gear fallback tail.
const SHELL_SOURCE = [
  'function navIcon(id) {',
  '\tif (id === "general") return (0, jsxRuntime.jsx)(primitives.IconSettingsOutlineMedium, {',
  '\t\tclassName: css.navIcon,',
  '\t\tsize: 16',
  '\t});',
  '\tif (id === "models") return (0, jsxRuntime.jsx)(primitives.IconDataOutlineMedium, {',
  '\t\tclassName: css.navIcon,',
  '\t\tsize: 16',
  '\t});',
  '\treturn (0, jsxRuntime.jsx)(primitives.IconSettingsOutlineMedium, {',
  '\t\tclassName: css.navIcon,',
  '\t\tsize: 16',
  '\t});',
  '}',
  '',
].join('\n')

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-adapter-nav-icon-'))
  tempDirs.push(dir)
  return dir
}
const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function writeShellFixture(dir, source = SHELL_SOURCE) {
  const file = join(dir, 'client.js')
  writeFileSync(file, source)
  return file
}

test('patch inserts the marked mcp branch after the models branch, once', () => {
  const file = writeShellFixture(tempDir())
  assert.equal(patchNavIconShell(file), 'patched')
  const patched = readFileSync(file, 'utf8')
  assert.ok(patched.includes(`${NAV_ICON_MARKER}`))
  assert.ok(patched.includes('if (id === "mcp") return (0, jsxRuntime.jsx)(primitives.IconLinkOutlineMedium'))
  assert.ok(patched.indexOf('id === "models"') < patched.indexOf('id === "mcp"'))
  assert.equal(patchNavIconShell(file), 'already-patched')
  assert.equal(readFileSync(file, 'utf8'), patched)

  assert.equal(revertNavIconShell(file), 'reverted')
  assert.equal(readFileSync(file, 'utf8'), SHELL_SOURCE)
  assert.equal(revertNavIconShell(file), 'nothing')
})

test('patch honors a custom icon name', () => {
  const file = writeShellFixture(tempDir())
  assert.equal(patchNavIconShell(file, 'IconShareOutlineMedium'), 'patched')
  assert.ok(readFileSync(file, 'utf8').includes('primitives.IconShareOutlineMedium'))
})

test('patch refuses a shell whose models branch it cannot pin', () => {
  const file = writeShellFixture(tempDir(), 'function navIcon(id) { return gear; }\n')
  assert.throws(() => patchNavIconShell(file), /Could not find the models branch/)
  assert.equal(readFileSync(file, 'utf8'), 'function navIcon(id) { return gear; }\n')
})

test('navIconDshRoot walks up from a bin-symlink entry to the DSH install', () => {
  const dir = tempDir()
  const dshRoot = join(dir, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(dshRoot, 'bin'), { recursive: true })
  writeFileSync(join(dshRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }))
  const target = join(dshRoot, 'bin', 'dsh.js')
  writeFileSync(target, '#!/usr/bin/env node\n')
  const link = join(dir, 'bindir', 'dsh')
  mkdirSync(join(dir, 'bindir'), { recursive: true })
  symlinkSync(target, link)

  assert.equal(navIconDshRoot(link), dshRoot)
  assert.equal(navIconDshRoot(target), dshRoot)
  assert.equal(navIconDshRoot(join(dir, 'unrelated.js')), undefined)
  assert.equal(navIconDshRoot(undefined), undefined)
})

test('locateNavIconShell prefers the explicit root and never guesses the npm root by default', () => {
  const dir = tempDir()
  const shellFile = join(dir, NAV_ICON_SHELL_RELATIVE)
  mkdirSync(join(shellFile, '..'), { recursive: true })
  writeFileSync(shellFile, SHELL_SOURCE)

  assert.equal(locateNavIconShell({ dshRoot: dir, argv: [] }), shellFile)
  // No root, no entry, npm fallback opted out: nothing is guessed.
  assert.equal(locateNavIconShell({ argv: [] }), undefined)
})

function loggerHarness() {
  const logs = { warn: [], info: [] }
  return {
    logs,
    ctx: { logger: { warn: (m) => logs.warn.push(m), info: (m) => logs.info.push(m) } },
  }
}

test('installMcpNavIconPatch self-heals an upgrade and never throws', () => {
  const dir = tempDir()
  const dshRoot = join(dir, 'root')
  const shellFile = join(dshRoot, NAV_ICON_SHELL_RELATIVE)
  mkdirSync(join(shellFile, '..'), { recursive: true })

  // First activation after an install: the shell gets the insert.
  writeFileSync(shellFile, SHELL_SOURCE)
  const first = loggerHarness()
  installMcpNavIconPatch(first.ctx, { dshRoot, argv: [] })
  assert.ok(readFileSync(shellFile, 'utf8').includes(NAV_ICON_MARKER))
  assert.equal(first.logs.info.length, 1)
  assert.equal(first.logs.warn.length, 0)

  // A DSH upgrade replaces the shell file; the next activation re-patches it.
  writeFileSync(shellFile, SHELL_SOURCE)
  const second = loggerHarness()
  installMcpNavIconPatch(second.ctx, { dshRoot, argv: [] })
  assert.ok(readFileSync(shellFile, 'utf8').includes(NAV_ICON_MARKER))
  assert.equal(second.logs.info.length, 1)

  // An unpatchable shell only warns.
  writeFileSync(shellFile, 'no navIcon here\n')
  const third = loggerHarness()
  installMcpNavIconPatch(third.ctx, { dshRoot, argv: [] })
  assert.equal(third.logs.warn.length, 1)
  assert.match(third.logs.warn[0], /did not apply/)
})

test('installMcpNavIconPatch warns instead of guessing when the install is unidentifiable', () => {
  const { logs, ctx } = loggerHarness()
  // An explicit miss plus an empty argv: nothing can resolve, and the npm
  // global root is opted out, so the hook must only warn.
  installMcpNavIconPatch(ctx, { dshRoot: join(tempDir(), 'no-such-install'), argv: [] })
  assert.equal(logs.warn.length, 1)
  assert.match(logs.warn[0], /could not locate the DSH settings shell bundle/)
})
