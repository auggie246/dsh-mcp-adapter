import assert from 'node:assert/strict'
import { test } from 'node:test'

import { installMcpSkill, parseSkillFrontmatter, SKILL_DIR } from '../src/host/skill.js'

const DOC = [
  '---',
  'name: mcp-adapter',
  'description: Drive MCP Servers through the Adapter Proxy Tool.',
  'whenToUse: When a tool must come from an MCP Server.',
  '---',
  '',
  '# Using the MCP Adapter',
  '',
  'Search first.',
].join('\n')

function fakeCtx() {
  const registered = []
  const warnings = []
  return {
    registered,
    warnings,
    skills: {
      register(skill) {
        registered.push(skill)
        return () => registered.pop()
      },
    },
    logger: { warn: (message) => warnings.push(message) },
  }
}

test('parseSkillFrontmatter splits the frontmatter block from the body', () => {
  const parsed = parseSkillFrontmatter(DOC)
  assert.equal(parsed.name, 'mcp-adapter')
  assert.equal(parsed.description, 'Drive MCP Servers through the Adapter Proxy Tool.')
  assert.equal(parsed.whenToUse, 'When a tool must come from an MCP Server.')
  assert.equal(parsed.body.startsWith('# Using the MCP Adapter'), true)
  assert.equal(parsed.body.includes('Search first.'), true)
})

test('parseSkillFrontmatter rejects a file without a leading frontmatter block', () => {
  assert.throws(() => parseSkillFrontmatter('# Just a body\n'), /frontmatter/)
  assert.throws(() => parseSkillFrontmatter('text\n---\nname: x\n---\n'), /frontmatter/)
})

test('installMcpSkill registers the bundled skill as a runtime skill', () => {
  const ctx = fakeCtx()
  const disposer = installMcpSkill(ctx, {
    readFileSync: () => DOC,
    dir: '/tmp/fake-skills/mcp-adapter/',
  })
  assert.equal(ctx.registered.length, 1)
  const skill = ctx.registered[0]
  assert.equal(skill.name, 'mcp-adapter')
  assert.equal(skill.description, 'Drive MCP Servers through the Adapter Proxy Tool.')
  assert.equal(skill.whenToUse, 'When a tool must come from an MCP Server.')
  assert.equal(skill.source, 'runtime')
  assert.equal(skill.content.startsWith('# Using the MCP Adapter'), true)
  assert.deepEqual(skill.resourceBase, { kind: 'directory', path: '/tmp/fake-skills/mcp-adapter/' })
  disposer()
  assert.deepEqual(ctx.registered, [])
  assert.deepEqual(ctx.warnings, [])
})

test('installMcpSkill warns and registers nothing when the skill file is unreadable', () => {
  const ctx = fakeCtx()
  const result = installMcpSkill(ctx, {
    readFileSync: () => {
      const error = new Error('no such file')
      error.code = 'ENOENT'
      throw error
    },
    dir: '/tmp/fake-skills/mcp-adapter/',
  })
  assert.equal(result, undefined)
  assert.deepEqual(ctx.registered, [])
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0], /bundled skill/)
})

test('installMcpSkill warns and registers nothing when frontmatter lacks required fields', () => {
  const ctx = fakeCtx()
  const result = installMcpSkill(ctx, {
    readFileSync: () => '---\nname: mcp-adapter\n---\n\n# Body',
    dir: '/tmp/fake-skills/mcp-adapter/',
  })
  assert.equal(result, undefined)
  assert.deepEqual(ctx.registered, [])
  assert.equal(ctx.warnings.length, 1)
})

test('the bundled SKILL.md is well-formed and teaches the Proxy Tool workflow', () => {
  const ctx = fakeCtx()
  const disposer = installMcpSkill(ctx)
  assert.equal(ctx.registered.length, 1, 'the real skill file registers against the real disk')

  const skill = ctx.registered[0]
  assert.equal(SKILL_DIR.endsWith('skills/mcp-adapter/'), true)
  assert.equal(skill.name, 'mcp-adapter')
  assert.match(skill.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  assert.ok(skill.description.length > 0)
  assert.equal(skill.source, 'runtime')
  assert.deepEqual(skill.resourceBase, { kind: 'directory', path: SKILL_DIR })
  for (const marker of ['action: "search"', 'action: "describe"', 'action: "call"', 'OAuth authorization required', '/mcp-auth']) {
    assert.equal(
      skill.content.includes(marker),
      true,
      `the skill body must teach ${JSON.stringify(marker)}`,
    )
  }
  assert.equal(typeof disposer, 'function')
})
